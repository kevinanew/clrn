import { expect, type Page } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { openLoginForm, unique } from './page';

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
  // 登录表单会自动注册不存在的用户名；测试账号缺失必须失败，禁止创建新账号。
  await page.route('**/public/v11/user/register/**', (route) => route.abort('blockedbyclient'));
  await openLoginForm(page);
  await (await unique(page, 'username-input')).fill(credentials.username);
  await (await unique(page, 'password-input')).fill(credentials.password);
  const loginResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/public/v10/user/login/username/password'
      && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await (await unique(page, 'sign-in-button')).click();
  const response = await loginResponse;
  if (!response.ok()) {
    // 登录失败时关闭密码表单，避免 Playwright 的错误上下文保存输入值。
    await page.close();
    throw new Error(`真实登录请求失败（HTTP ${response.status()}，节点 ${new URL(response.url()).hostname}）`);
  }
  await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible({ timeout: 60_000 });
  const session = await page.evaluate(() => {
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
  }).catch(() => {
    // APIRequestContext 的原始错误包含请求头，不能直接写入测试报告。
    throw new Error('账号会话状态读取失败：网络请求未完成');
  });
  const status = response.status();
  await response.dispose();
  return status;
}
