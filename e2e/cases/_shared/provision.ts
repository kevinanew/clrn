import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { Session } from './auth';
import { openHall, openLoginForm, prepareContext, unique } from './page';

export type ProvisionedAccount = Session & {
  username: string;
  diamondBalance: number;
  registrationDiamondBalance: number;
};

export async function readDiamondBalance(page: Page, account: Session): Promise<number> {
  const response = await page.request.put(
    `${new URL(account.accountUrl).origin}/v10/wallet/${encodeURIComponent(account.userId)}`,
    {
      headers: { Authorization: account.authorization },
      data: { currencies: ['diamond'] },
    },
  );
  expect(response.ok(), '测试账号钱包应可读取').toBeTruthy();
  const body = await response.json();
  await response.dispose();
  expect(body.ok, '钱包业务响应应成功').toBe(true);
  const diamond = body.result?.currencies?.find((asset: { code: string }) => asset.code === 'diamond');
  expect(diamond, '钱包应返回 diamond 币种').toBeDefined();
  const balance = Number(diamond.balance);
  expect(Number.isFinite(balance), '钻石余额应为有限数字').toBeTruthy();
  return balance;
}

/** 每次调用使用新设备、新用户名；仅通过 staging 的真实注册界面创建测试账号。 */
export async function registerAccount(page: Page): Promise<ProvisionedAccount> {
  try {
    return await registerOnStaging(page);
  } catch (error) {
    // 连初始化失败也不能让报告保存用户名/密码输入框的 DOM 快照。
    await page.close().catch(() => undefined);
    throw error;
  }
}

async function registerOnStaging(page: Page): Promise<ProvisionedAccount> {
  await prepareContext(page.context(), randomUUID());
  await openHall(page);
  const target = new URL(page.url());
  expect(target.protocol).toBe('https:');
  expect(['h5.page.shafayouxi.org', 'h5.shafayouxi.org']).toContain(target.hostname);
  const username = `e2e${randomBytes(7).toString('hex')}`;
  const password = `T${randomBytes(7).toString('hex')}9`;
  await openLoginForm(page);
  await (await unique(page, 'username-input')).fill(username);
  await (await unique(page, 'password-input')).fill(password);
  await expect.poll(async () => (await unique(page, 'password-input')).inputValue().then(value => value === password), {
    message: '注册密码应符合长度限制并已填入',
  }).toBe(true);
  const registration = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/public/v11/user/register/username_password'
    && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  const login = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/public/v10/user/login/username/password',
    { timeout: 60_000 },
  ).catch(() => null);
  let signedIn;
  try {
    const [registered] = await Promise.all([
      registration,
      (await unique(page, 'sign-in-button')).click(),
    ]);
    const body = await registered.json();
    if (!registered.ok() || body.ok !== true) {
      const message = await page.getByTestId('confirm-button').isVisible()
        ? '注册被 staging 拒绝，请检查注册限额及页面提示'
        : '注册被 staging 拒绝，请检查注册限额';
      throw new Error(`${message}（HTTP ${registered.status()}）`);
    }
    signedIn = await login;
    expect(signedIn, '注册成功后应收到自动登录响应').not.toBeNull();
    expect(signedIn!.ok(), '注册后自动登录应成功').toBeTruthy();
    expect((await signedIn!.json()).ok, '登录业务响应应成功').toBe(true);
  } catch (error) {
    // Playwright 的失败 DOM 快照会记录 input 值，即使 type=password；先清空随机凭据。
    for (const id of ['username-input', 'password-input']) {
      const input = page.getByTestId(id).filter({ visible: true });
      if (await input.count()) await input.fill('').catch(() => undefined);
    }
    throw error;
  }
  await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible({ timeout: 60_000 });
  const session = await page.evaluate(() => {
    const raw = localStorage.getItem('save.user.origin.data.from.server.key');
    const auth = raw ? JSON.parse(raw) : null;
    if (!auth?.user_id || !auth?.api_token?.access_token || !auth?.api_token?.token_type) {
      throw new Error('注册后没有完整登录状态');
    }
    return { userId: String(auth.user_id), authorization: `${auth.api_token.token_type} ${auth.api_token.access_token}` };
  });
  const account: Session = {
    ...session,
    accountUrl: `${new URL(signedIn!.url()).origin}/v11/user/${encodeURIComponent(session.userId)}/account`,
  };
  const diamondBalance = await readDiamondBalance(page, account);
  return { ...account, username, diamondBalance, registrationDiamondBalance: diamondBalance };
}
