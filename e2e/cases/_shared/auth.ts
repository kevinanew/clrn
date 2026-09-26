import { expect, type Page } from '@playwright/test';
import { environment } from '../../helpers/environment';
import { openLoginForm, unique } from './page';

export type Session = { userId: string; accountUrl: string; authorization: string };

export async function signIn(page: Page): Promise<Session> {
  // 登录表单会自动注册不存在的用户名；测试账号缺失必须失败，禁止创建新账号。
  await page.route('**/public/v11/user/register/**', (route) => route.abort('blockedbyclient'));
  await openLoginForm(page);
  await (await unique(page, 'username-input')).fill(environment.testUsername);
  await (await unique(page, 'password-input')).fill(environment.testPassword);
  const loginResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/public/v10/user/login/username/password',
    { timeout: 60_000 },
  );
  await (await unique(page, 'sign-in-button')).click();
  const response = await loginResponse;
  expect(response.ok(), '真实登录请求应成功').toBeTruthy();
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

export async function accountStatus(page: Page, session: Session): Promise<number> {
  const response = await page.request.get(session.accountUrl, {
    headers: { Authorization: session.authorization },
    timeout: 15_000,
  });
  const status = response.status();
  await response.dispose();
  return status;
}
