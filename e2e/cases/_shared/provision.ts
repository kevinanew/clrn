import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { signIn, type Session } from './auth';
import { createTestingAccount } from './test-user';
import { readTestApiToken } from './test-wallet';
import { openHall, prepareContext } from './page';

export type ProvisionedAccount = Session & {
  username: string;
  diamondBalance: number;
  initialDiamondBalance: number;
};

/** 仅携带固定、无凭据的诊断，允许 fixture 原样报告测试注册失败。 */
export class RegistrationRejectedError extends Error {}

/**
 * 读取真实钱包响应中的钻石余额，拒绝缺失币种或非数值余额。
 * @param page - 执行操作的 Playwright 页面。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
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

/**
 * 每次调用使用新设备、新用户名；通过 staging 测试接口创建账号，再从真实界面登录。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function registerAccount(page: Page): Promise<ProvisionedAccount> {
  try {
    return await registerOnStaging(page);
  } catch (error) {
    // 连初始化失败也不能让报告保存用户名/密码输入框的 DOM 快照。
    await page.close().catch(() => undefined);
    throw error;
  }
}

/**
 * 使用独立设备和随机凭据注册 staging 测试账号，验证真实登录和初始余额。
 * @param page - 执行操作的 Playwright 页面。
 */
async function registerOnStaging(page: Page): Promise<ProvisionedAccount> {
  await prepareContext(page.context(), randomUUID());
  await openHall(page);
  const target = new URL(page.url());
  expect(target.protocol).toBe('https:');
  expect(['h5.page.shafayouxi.org', 'h5.shafayouxi.org']).toContain(target.hostname);
  const username = `e2e${randomBytes(7).toString('hex')}`;
  const password = `T${randomBytes(7).toString('hex')}9`;
  let created;
  try {
    const token = await readTestApiToken();
    created = await createTestingAccount({ username, password }, token);
  } catch (error) {
    throw new RegistrationRejectedError(error instanceof Error ? error.message : '测试账号创建失败');
  }
  const account = await signIn(page, { username, password });
  expect(account.userId === created.userId, '登录账号必须与测试接口创建的账号一致').toBe(true);
  const diamondBalance = await readDiamondBalance(page, account);
  expect(diamondBalance, '测试注册不发放钻石奖励').toBe(0);
  return { ...account, username, diamondBalance, initialDiamondBalance: diamondBalance };
}
