import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { accountStatus, signIn, type Session } from './auth';
import { openHall, prepareContext, unique } from './page';
import { readDiamondBalance } from './provision';
import { installSignInNoticeHandler } from './sign-in-notices';
import { requestFailure, requestFailureReason, safeDiagnosticReason } from '../../../scripts/request-failure.cjs';

export type SignedInAccount = Session & { username: string; diamondBalance: number };

export const test = base.extend<{
  signedInAccount: SignedInAccount;
  /** 兼容旧只读案例；新案例使用 signedInAccount，避免暗示注册新账号。 */
  newAccount: SignedInAccount;
}>({
  /**
   * 登录既有只读测试账号并校验会话与钱包，禁止注册缺失账号。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  signedInAccount: async ({ page, context }, use) => {
    const account = await prepareReadAccount(page, context);
    // 提示可能晚于登录返回；在后续操作前取消救济金，不改变账号资产。
    await installSignInNoticeHandler(page);
    await (await unique(page, 'hall-search-button')).click({ trial: true });
    await use(account);
  },
  /**
   * 提供本轮创建或恢复的测试账号，交给案例执行并验证会话归属。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  newAccount: async ({ signedInAccount }, use) => {
    await use(signedInAccount);
  },
});

/**
 * 准备既有只读账号；每个边界保留固定阶段，任何失败仍关闭密码页面并中止案例。
 * @param page - 本例页面，不创建或注册新账号。
 * @param context - 本例独立的浏览器上下文。
 */
export async function prepareReadAccount(page: Page, context: BrowserContext): Promise<SignedInAccount> {
  let operation = 'existing-account-setup';
  try {
    await prepareContext(context);
    await openHall(page);
    operation = 'existing-account-origin';
    expect(new URL(page.url()).origin, '只读账号只能登录配置的 staging').toBe(new URL(environment.stagingUrl).origin);
    operation = 'existing-account-login-ui';
    // signIn 阻断自动注册接口；账号不存在时失败，绝不注册。
    const session = await signIn(page);
    operation = 'existing-account-session-check';
    const status = await accountStatus(page, session);
    if (status !== 200) throw requestFailure('existing-account-session', status < 200 || status >= 300 ? 'http-error' : 'invalid-response', status);
    operation = 'existing-account-wallet-check';
    return { ...session, username: environment.testUsername, diamondBalance: await readDiamondBalance(page, session) };
  } catch (error) {
    // 避免 setup 失败时保存密码表单 DOM 或带 Authorization 的请求错误。
    await page.close().catch(() => undefined);
    throw readAccountPreparationError(error, operation);
  }
}

/**
 * 上层仅传播本进程已审阅的请求定位；未知页面错误保留准备阶段，不回显原始异常。
 * @param error - 登录、会话或钱包边界捕获的异常。
 * @param operation - 未知错误发生时的固定本地准备阶段。
 */
export function readAccountPreparationError(error: unknown, operation = 'existing-account-setup'): Error {
  const diagnostic = safeDiagnosticReason(error);
  // 字符串枚举（如 timeout）不能代替有业务定位的完整可信错误。
  if (diagnostic.includes(' operation=')) return new Error(diagnostic);
  const localOperation = ['existing-account-origin', 'existing-account-login-ui',
    'existing-account-session-check', 'existing-account-wallet-check'].includes(operation)
    ? operation : 'existing-account-setup';
  return requestFailure(localOperation, requestFailureReason(error));
}

export { expect };
