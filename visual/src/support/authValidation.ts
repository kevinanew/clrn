import { type APIResponse, type Page } from '@playwright/test';
import { requestErrorSummary } from './requestError';

export const USER_ATTRIBUTE_STORAGE_KEY = 'save.user.origin.data.from.server.key';
const ACCOUNT_VALIDATION_TIMEOUT_MS = 10000;
const ACCOUNT_CACHE_POLL_INTERVAL_MS = 100;
const APP_SIGN_IN_STABILITY_MS = 3000;
const VISUAL_API_BASE_URL =
  process.env.VISUAL_API_BASE_URL || 'https://64.kr-seoul.api.staging.laiwan.shafayouxi.com';

type PersistedAuth = {
  userId: string;
  accessToken: string;
  tokenType: string;
};

type SignInValidationOptions = {
  /** 仅供 visual 自身回归测试把只读账户请求指向本地测试服务。 */
  apiBaseUrl?: string;
  /** 生产视觉流程使用真实请求超时；回归测试可缩短不可达/超时用例。 */
  requestTimeoutMs?: number;
  /**
   * 账户接口确认 token 后，还要等待应用完成自身的缓存恢复。采集器和真实场景
   * 都需要此检查；纯账户接口单测无需构造完整的 RN 页面。
   */
  requireAppState?: boolean;
};

/**
 * 从应用持久化的 UserAttribute 原始数据中读取账户校验所需字段。缺少 user_id、
 * access_token 或 token_type 都不能构成可验证的登录态，也不应发起账户请求。
 */
async function readPersistedAuth(page: Page): Promise<PersistedAuth | null> {
  return page
    .evaluate((storageKey: string) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw);
        const userId = parsed?.user_id;
        const accessToken = parsed?.api_token?.access_token;
        const tokenType = parsed?.api_token?.token_type;
        if (
          typeof userId !== 'string' ||
          !userId.trim() ||
          typeof accessToken !== 'string' ||
          !accessToken.trim() ||
          typeof tokenType !== 'string' ||
          !tokenType.trim()
        ) {
          return null;
        }
        return {
          userId: userId.trim(),
          accessToken: accessToken.trim(),
          tokenType: tokenType.trim(),
        };
      } catch {
        return null;
      }
    }, USER_ATTRIBUTE_STORAGE_KEY)
    .catch(() => null);
}

export async function isSignedIn(page: Page): Promise<boolean> {
  return Boolean(await readPersistedAuth(page));
}

/**
 * 账户接口只说明 token 在请求瞬间有效，不能说明 RN Web 已接受注入缓存。应用启动时
 * 仍可能有迟到的鉴权请求清除 localStorage；须在大厅的真实登录态连续稳定后才允许
 * 截图。这里保留账户校验，而不是退回到只看 UI，避免旧 UI 残留掩盖失效 token。
 */
async function waitForRestoredAppSignIn(page: Page): Promise<'signedIn' | 'signedOut'> {
  const deadline = Date.now() + 30000;
  let signedInSince: number | undefined;

  while (Date.now() < deadline) {
    const persistedAuth = await readPersistedAuth(page);
    if (!persistedAuth) {
      return 'signedOut';
    }

    const signedOut = await page
      .locator('[data-testid="hall-sign-in-button"]:visible')
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    const appRestoredSignedIn = await page
      .locator('[data-testid="hall-auth-state-signed-in"]:visible')
      .count()
      .then((count) => count > 0)
      .catch(() => false);

    if (appRestoredSignedIn && !signedOut) {
      signedInSince ??= Date.now();
      if (Date.now() - signedInSince >= APP_SIGN_IN_STABILITY_MS) {
        return 'signedIn';
      }
    } else {
      signedInSince = undefined;
    }
    await page.waitForTimeout(ACCOUNT_CACHE_POLL_INTERVAL_MS);
  }

  return 'signedOut';
}

/**
 * 使用 Playwright request context 调用只读账户接口验证持久化 token。只有 2xx 且
 * 请求完成后缓存仍与发起请求时一致才可放行。401 或等待期间缓存被清除表示登出；
 * 网络错误、超时、限流及服务端/未知响应都必须明确终止视觉场景。
 */
export async function waitForSignInState(
  page: Page,
  options: SignInValidationOptions = {},
): Promise<'signedIn' | 'signedOut'> {
  const persistedAuth = await readPersistedAuth(page);
  if (!persistedAuth) {
    return 'signedOut';
  }

  const requestTimeoutMs = options.requestTimeoutMs ?? ACCOUNT_VALIDATION_TIMEOUT_MS;
  const apiBaseUrl = (options.apiBaseUrl ?? VISUAL_API_BASE_URL).replace(/\/$/, '');
  const accountUrl = `${apiBaseUrl}/v11/user/${encodeURIComponent(persistedAuth.userId)}/account`;
  let stopWatchingCache = false;

  const requestResult = page.request
    .get(accountUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `${persistedAuth.tokenType} ${persistedAuth.accessToken}`,
      },
      timeout: requestTimeoutMs,
    })
    .then((response: APIResponse) => ({ kind: 'response' as const, response }))
    .catch((error: unknown) => ({ kind: 'error' as const, error }));

  const cacheCleared = (async () => {
    while (!stopWatchingCache) {
      const current = await readPersistedAuth(page);
      if (!current) {
        return { kind: 'signedOut' as const };
      }
      await page.waitForTimeout(ACCOUNT_CACHE_POLL_INTERVAL_MS);
    }
    return { kind: 'stopped' as const };
  })();

  const result = await Promise.race([requestResult, cacheCleared]);
  stopWatchingCache = true;

  if (result.kind === 'signedOut') {
    return 'signedOut';
  }
  const authAfterRequest = await readPersistedAuth(page);
  if (!authAfterRequest) {
    return 'signedOut';
  }
  if (result.kind === 'error') {
    const message = requestErrorSummary(result.error);
    throw new Error(`SIGN-IN > 账户接口校验失败（网络错误或超时）：${message}`);
  }
  if (result.kind === 'stopped') {
    throw new Error('SIGN-IN > 账户接口校验被意外中止');
  }

  const status = result.response.status();
  if (status === 401) {
    return 'signedOut';
  }
  if (status < 200 || status >= 300) {
    throw new Error(`SIGN-IN > 账户接口校验无法确认 token 有效（HTTP ${status}）`);
  }

  if (
    authAfterRequest.userId !== persistedAuth.userId ||
    authAfterRequest.accessToken !== persistedAuth.accessToken ||
    authAfterRequest.tokenType !== persistedAuth.tokenType
  ) {
    throw new Error('SIGN-IN > 账户接口校验期间登录缓存已变更，无法确认当前 token 有效');
  }
  if (options.requireAppState) {
    return waitForRestoredAppSignIn(page);
  }
  return 'signedIn';
}
