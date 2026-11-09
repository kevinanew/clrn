import { type APIResponse, type Page } from '@playwright/test';
import { requestFailure, requestErrorSummary } from './requestError';

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
 * @param page - 执行操作的 Playwright 页面。
 */
async function readPersistedAuth(page: Page): Promise<PersistedAuth | null> {
  return page
    .evaluate(/** 安全解析认证缓存，只返回字段完整且类型合法的持久化登录态。
 * @param storageKey - 当前操作使用的 storageKey。 */ (storageKey: string) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      const fields = {
        /** 安全读取可空对象字段。
         * @param value - 缓存对象。
         * @param key - 固定字段名。 */
        property(value: any, key: string): unknown { return value?.[key]; },
        /** 读取非空字符串字段，剔除空白。
         * @param value - 缓存中的原始字段。 */
        text(value: unknown): string {
          return typeof value === 'string' ? value.trim() : '';
        },
        /** 解析用户和令牌字段，拒绝不完整的身份。
         * @param raw - localStorage 原始 JSON。 */
        parse(raw: string): PersistedAuth | null {
          const parsed = JSON.parse(raw);
          const token = fields.property(parsed, 'api_token');
          const userId = fields.text(fields.property(parsed, 'user_id'));
          const accessToken = fields.text(fields.property(token, 'access_token'));
          const tokenType = fields.text(fields.property(token, 'token_type'));
          if (![userId, accessToken, tokenType].every(Boolean)) return null;
          return { userId, accessToken, tokenType };
        },
      };
      try {
        return fields.parse(raw);
      } catch {
        return null;
      }
    }, USER_ATTRIBUTE_STORAGE_KEY)
    .catch(/** 读取失败时返回空值，保留调用方的缺失数据处理。 */ () => null);
}

/**
 * 读取持久化认证缓存并确认它包含完整用户身份。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function isSignedIn(page: Page): Promise<boolean> {
  return Boolean(await readPersistedAuth(page));
}

/**
 * 账户接口只说明 token 在请求瞬间有效，不能说明 RN Web 已接受注入缓存。应用启动时
 * 仍可能有迟到的鉴权请求清除 localStorage；须在大厅的真实登录态连续稳定后才允许
 * 截图。这里保留账户校验，而不是退回到只看 UI，避免旧 UI 残留掩盖失效 token。
 * @param page - 执行操作的 Playwright 页面。
 */
async function waitForRestoredAppSignIn(page: Page): Promise<'signedIn' | 'signedOut'> {
  const deadline = Date.now() + 30000;
  let signedInSince: number | undefined;

  while (Date.now() < deadline) {
    const state = await restoredSignInPoll(page, signedInSince);
    if (state.result) return state.result;
    signedInSince = state.since;
    await page.waitForTimeout(ACCOUNT_CACHE_POLL_INTERVAL_MS);
  }

  return 'signedOut';
}

/**
 * 使用 Playwright request context 调用只读账户接口验证持久化 token。只有 2xx 且
 * 请求完成后缓存仍与发起请求时一致才可放行。401 或等待期间缓存被清除表示登出；
 * 网络错误、超时、限流及服务端/未知响应都必须明确终止视觉场景。
 * @param page - 执行操作的 Playwright 页面。
 * @param options - 本次操作的可选配置。
 */
export async function waitForSignInState(
  page: Page,
  options: SignInValidationOptions = {},
): Promise<'signedIn' | 'signedOut'> {
  const persistedAuth = await readPersistedAuth(page);
  if (!persistedAuth) {
    return 'signedOut';
  }

  const result = await validateAccountRequest(page, persistedAuth, options);
  return finishAccountValidation(page, persistedAuth, result, options);
}

/** 发送账户请求并与缓存清除轮询竞速。
 * @param page - 当前页面。
 * @param persistedAuth - 请求开始时的认证缓存。
 * @param options - 请求边界配置。 */
async function validateAccountRequest(page: Page, persistedAuth: PersistedAuth, options: SignInValidationOptions) {
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
    .then(/** 将异步结果转换为`{ kind: 'response' as const, response }`，供后续步骤使用。
 * @param response - 当前收到的接口响应。 */ (response: APIResponse) => ({ kind: 'response' as const, response }))
    .catch(/** 将账号请求异常转换为显式错误分支，交给会话竞态处理。
 * @param error - 当前操作抛出的错误。 */ (error: unknown) => ({ kind: 'error' as const, error }));

  const cacheCleared = (/** 轮询认证缓存是否被清除，使登出能及时终止等待中的会话核验。 */ async () => {
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

  return result;
}

type AccountResult = Awaited<ReturnType<typeof validateAccountRequest>>;

/** 按响应种类保留请求错误和意外中止的原始处理。
 * @param result - 竞速结果。 */
function accountResponse(result: AccountResult): APIResponse {
  if (result.kind === 'response') return result.response;
  if (result.kind === 'error') throw new Error(requestErrorSummary(result.error, 'validate-account'));
  throw new Error('SIGN-IN > 账户接口校验被意外中止');
}

/** 校验实际 HTTP 状态，401 仍由调用方判断登出。
 * @param response - 真实账户响应。 */
function successfulAccountResponse(response: APIResponse): boolean {
  const status = response.status();
  if (status === 401) return false;
  if (!isSuccessStatus(status)) throw requestFailure('validate-account', 'http-error', status);
  return true;
}

/** 确认请求前后的账户与令牌完全一致。
 * @param before - 请求前缓存。
 * @param after - 请求后缓存。 */
function assertUnchangedAuth(before: PersistedAuth, after: PersistedAuth): void {
  const keys = ['userId', 'accessToken', 'tokenType'] as const;
  if (keys.some(/** 任意身份字段变化都不能复用本次账户校验。
   * @param key - 身份字段名。 */ key => before[key] !== after[key])) {
    throw new Error('SIGN-IN > 账户接口校验期间登录缓存已变更，无法确认当前 token 有效');
  }
}

/** HTTP 校验完成后按配置等待应用恢复。
 * @param page - 当前页面。
 * @param before - 请求前缓存。
 * @param after - 请求后缓存。
 * @param response - 账户响应。
 * @param options - 应用恢复配置。 */
async function finishValidResponse(page: Page, before: PersistedAuth, after: PersistedAuth,
  response: APIResponse, options: SignInValidationOptions): Promise<'signedIn' | 'signedOut'> {
  if (!successfulAccountResponse(response)) return 'signedOut';
  assertUnchangedAuth(before, after);
  return options.requireAppState ? waitForRestoredAppSignIn(page) : 'signedIn';
}

/** 缓存清除优先于请求错误；有效响应再核对身份隔离。
 * @param page - 当前页面。
 * @param before - 请求前缓存。
 * @param result - 请求与缓存竞速结果。
 * @param options - 应用恢复配置。 */
async function finishAccountValidation(page: Page, before: PersistedAuth, result: AccountResult,
  options: SignInValidationOptions): Promise<'signedIn' | 'signedOut'> {
  if (result.kind === 'signedOut') return 'signedOut';
  const after = await readPersistedAuth(page);
  if (!after) return 'signedOut';
  return finishValidResponse(page, before, after, accountResponse(result), options);
}

/** 读取真实大厅标记，失败仍视为未满足。
 * @param page - 当前页面。
 * @param selector - 登录或登出标记。 */
async function hasAppMarker(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).count().then(/** 至少一个标记才算存在。
   * @param count - 标记数。 */ count => count > 0).catch(/** 读取失败继续轮询。 */ () => false);
}

/** 连续登录计时在任一登出标记出现时重置。
 * @param page - 当前页面。
 * @param since - 前一轮连续登录起点。 */
async function restoredSignInSince(page: Page, since: number | undefined): Promise<number | undefined> {
  const signedOut = await hasAppMarker(page, '[data-testid="hall-sign-in-button"]:visible');
  const signedIn = await hasAppMarker(page, '[data-testid="hall-auth-state-signed-in"]:visible');
  if (![signedIn, !signedOut].every(Boolean)) return undefined;
  return since ?? Date.now();
}

/** 判定连续登录是否覆盖原有三秒稳定窗口。
 * @param since - 连续登录起点。 */
function isStableSignIn(since: number | undefined): boolean {
  return since !== undefined && Date.now() - since >= APP_SIGN_IN_STABILITY_MS;
}

/** 每轮先检测缓存清除，再读取真实界面登录态。
 * @param page - 当前页面。
 * @param since - 前一轮连续登录起点。 */
async function restoredSignInPoll(page: Page, since: number | undefined) {
  if (!await readPersistedAuth(page)) return { result: 'signedOut' as const, since: undefined };
  const next = await restoredSignInSince(page, since);
  return { result: isStableSignIn(next) ? 'signedIn' as const : undefined, since: next };
}

/** 判断真实 HTTP 状态是否在原有成功区间。
 * @param status - 响应状态。 */
function isSuccessStatus(status: number): boolean { return status >= 200 && status < 300; }
