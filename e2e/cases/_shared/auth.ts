import { expect, type Page, type Request } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { openLoginForm, unique } from './page';
import { requestFailure, requestFailureReason } from '../../../scripts/request-failure.cjs';

export type Session = { userId: string; accountUrl: string; authorization: string };

/**
 * 从用户名表单登录既有测试账号并返回会话，禁止自动注册缺失账号。
 * @param page - 执行操作的 Playwright 页面。
 * @param credentials - 登录凭据，包含 username 用户名和 password 密码。
 */
export async function signIn(page: Page, credentials = {
  username: environment.testUsername,
  password: environment.testPassword,
}): Promise<Session> {
  let status: number | undefined;
  let waiting = false;
  let observed = false;
  /**
   * 只记录固定登录请求确已发出，不读取地址、认证头或表单内容用于诊断。
   * @param request - 浏览器实际发出的请求。
   */
  const observeLogin = (request: Request) => {
    if (request.method() === 'POST'
      && new URL(request.url()).pathname === '/public/v10/user/login/username/password') observed = true;
  };
  try {
    // 登录表单会自动注册不存在的用户名；测试账号缺失必须失败，禁止创建新账号。
    await page.route('**/public/v11/user/register/**', /** 阻断自动注册请求，避免只读账号登录创建新账号。
 * @param route - 当前拦截的网络请求。 */ (route) => route.abort('blockedbyclient'));
    await openLoginForm(page);
    await (await unique(page, 'username-input')).fill(credentials.username);
    await (await unique(page, 'password-input')).fill(credentials.password);
    page.on('request', observeLogin);
    waiting = true;
    const loginResponse = page.waitForResponse(
      /** 匹配POST `/public/v10/user/login/username/password` 的响应，避免捕获其他请求。
 * @param response - 当前收到的接口响应。 */ (response) => new URL(response.url()).pathname === '/public/v10/user/login/username/password'
        && response.request().method() === 'POST',
      { timeout: 60_000 },
    ).then(/** 记录登录响应的真实状态，并向后续登录步骤传递响应。
 * @param response - 当前收到的接口响应。 */ response => {
      status = response.status();
      return { response };
    }, /** 将异步结果转换为`{ error }`，供后续步骤使用。
 * @param error - 当前操作抛出的错误。 */ error => ({ error }));
    await (await unique(page, 'sign-in-button')).click();
    const result = await loginResponse;
    if ('error' in result) throw result.error;
    const response = result.response;
    if (!response.ok()) {
      // 登录失败时关闭密码表单，避免 Playwright 的错误上下文保存输入值。
      throw requestFailure('existing-account-login', 'http-error', status);
    }
    await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible({ timeout: 60_000 });
    const session = await page.evaluate(/** 从页面缓存读取完整用户和访问令牌，缺失时终止登录准备。 */ () => {
      const raw = localStorage.getItem('save.user.origin.data.from.server.key');
      const auth = raw ? JSON.parse(raw) : null;
      if (!auth?.user_id || !auth?.api_token?.access_token || !auth?.api_token?.token_type) {
        throw new Error('登录后未生成完整认证缓存');
      }
      return { userId: String(auth.user_id), authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}` };
    });
    return {
      userId: session.userId,
      accountUrl: `${new URL(response.url()).origin}/v11/user/${encodeURIComponent(session.userId)}/account`,
      authorization: session.authorization,
    };
  } catch (error) {
    await page.close().catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
    const operation = status !== undefined || observed ? 'existing-account-login'
      : waiting ? 'existing-account-login-await' : 'existing-account-login-ui';
    throw requestFailure(operation, status === undefined ? requestFailureReason(error)
      : status < 200 || status >= 300 ? 'http-error' : 'invalid-response', status);
  } finally {
    page.off('request', observeLogin);
  }
}

/**
 * 携带当前会话读取状态码，仅重试连接重置，失败诊断不包含认证头。
 * @param page - 执行操作的 Playwright 页面。
 * @param session - 当前登录会话的接口地址和认证信息。
 */
export async function accountStatus(page: Page, session: Session): Promise<number> {
  const response = await page.request.get(session.accountUrl, {
    headers: { Authorization: session.authorization },
    timeout: 15_000,
    // Playwright 只对 ECONNRESET 重试；200、401 等 HTTP 响应保持原样。
    maxRetries: 2,
  }).catch(/** 将读取会话的底层错误转成不含认证头的诊断。
 * @param error - 当前操作抛出的错误。 */ error => {
    // APIRequestContext 的原始错误包含请求头，不能直接写入测试报告。
    throw requestFailure('existing-account-session', requestFailureReason(error));
  });
  const status = response.status();
  await response.dispose().catch(/** 将会话响应释放失败转成带真实状态的安全诊断。 */ () => { throw requestFailure('existing-account-session', 'body-read-failed', status); });
  return status;
}
