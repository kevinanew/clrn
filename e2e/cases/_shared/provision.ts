/** 通过 Staging 后端创建独立测试账号，在指定前端入口验证真实登录和余额。 */
import { environment } from "../../helpers/environment";
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { signIn, type Session } from './auth';
import { createTestingAccount } from './test-user';
import { readTestApiToken } from './test-wallet';
import { openHall, prepareContext } from './page';
import { requestFailure, requestFailureReason } from '../../../scripts/request-failure.cjs';
import { readRequestJson } from '../../../visual/src/support/requestJson';
import { accountPreparationError } from './account-diagnostics';

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
  ).catch(/** 将钱包读取失败转成不含凭据的业务诊断。
 * @param error - 当前操作抛出的错误。 */ error => { throw requestFailure('existing-account-wallet', requestFailureReason(error)); });
  try {
    const body = await readRequestJson(response, 'existing-account-wallet');
    return diamondBalance(body, response.status());
  } finally {
    await response.dispose().catch(/** 将钱包响应释放失败转成带实际状态的诊断。 */ () => { throw requestFailure('existing-account-wallet', 'body-read-failed', response.status()); });
  }
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
    await page.close().catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
    const failure = accountPreparationError(error, 'register-account-setup');
    throw error instanceof RegistrationRejectedError ? new RegistrationRejectedError(failure.message) : failure;
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
  expect(target.origin).toBe(new URL(environment.stagingUrl).origin);
  const username = `e2e${randomBytes(7).toString('hex')}`;
  const password = `T${randomBytes(7).toString('hex')}9`;
  let created;
  try {
    const token = await readTestApiToken();
    created = await createTestingAccount({ username, password }, token);
  } catch (error) {
    throw new RegistrationRejectedError(accountPreparationError(error, 'register-account-setup').message);
  }
  const account = await signIn(page, { username, password });
  expect(account.userId === created.userId, '登录账号必须与测试接口创建的账号一致').toBe(true);
  const diamondBalance = await readDiamondBalance(page, account);
  expect(diamondBalance, '测试注册不发放钻石奖励').toBe(0);
  return { ...account, username, diamondBalance, initialDiamondBalance: diamondBalance };
}

/**
 * 校验钱包契约并读取有限数值余额。
 * @param body - 已通过 HTTP 与业务检查的响应。
 * @param status - 实际 HTTP 状态。
 */
function diamondBalance(body: any, status: number): number {
  const diamond = diamondAsset(body.result?.currencies);
  if (!diamond) throw requestFailure('existing-account-wallet', 'invalid-response', status);
  return numericDiamondBalance(diamond.balance, status);
}

/**
 * 从币种数组查找钻石，非数组保持契约失败。
 * @param currencies - 钱包币种字段。
 */
function diamondAsset(currencies: any) {
  return Array.isArray(currencies) ? currencies.find(/** 匹配钻石币种。
   * @param asset - 一个币种条目。 */ asset => asset?.code === 'diamond') : undefined;
}

/**
 * 转换余额时保留类型转换失败与非有限数值的原有诊断。
 * @param value - 钻石余额字段。
 * @param status - 实际 HTTP 状态。
 */
function numericDiamondBalance(value: unknown, status: number): number {
  let balance: number;
  try { balance = Number(value); }
  catch { throw requestFailure('existing-account-wallet', 'invalid-response', status); }
  if (!Number.isFinite(balance)) throw requestFailure('existing-account-wallet', 'invalid-response', status);
  return balance;
}
