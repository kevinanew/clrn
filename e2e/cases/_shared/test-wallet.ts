import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Session } from './auth';
import { requestFailure } from '../../../scripts/request-failure.cjs';
import { fetchRequestJson } from '../../../visual/src/support/requestJson';
import { validTestingUserId } from './test-user';
import { parseAccountUrl } from './account-diagnostics';

const stagingWalletOrigin = 'https://api.shafayouxi.org';

/** CI 使用 Secret；本机可直接复用相邻 staging 部署仓库中的共用 Secret。 */
export async function readTestApiToken(): Promise<string> {
  const configured = configuredTestApiToken();
  if (configured) return configured;
  const local = await localTestApiToken();
  if (local) return local;
  throw new Error('缺少 TESTING_API_TOKEN；请配置环境变量或本机相邻 staging 部署文件的 test-api-token Secret');
}

/**
 * 在发送任何管理请求前核对创建专用账号的钱包归属。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
function validateCreationWallet(account: Session): void {
  const url = parseAccountUrl(account.accountUrl);
  const valid = [url.protocol === 'https:', !url.port, !url.username, !url.password,
    stagingWalletApi(url), validTestingUserId(account.userId), url.pathname === `/v11/user/${account.userId}/account`];
  if (!valid.every(Boolean)) throw new Error('设置测试余额仅允许 staging 创建账号的钱包');
}

/**
 * 仅为已验证登录的 staging 创建专用账号设置钻石，不通过浏览器发送管理 token。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 * @param token - 仅用于测试接口或代理控制接口的认证凭据。
 */
export async function setCreationDiamondBalance(account: Session, token: string): Promise<void> {
  validateCreationWallet(account);
  const { body, status } = await fetchRequestJson(`${stagingWalletOrigin}/public/v1/wallet/${account.userId}/set_balance/testing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Testing-Api-Token': token },
    body: JSON.stringify({ currency_name: 'diamond', balance: '60' }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }, 'set-creation-diamonds');
  validateSetBalance(body.result, account.userId, status);
}

/**
 * 核对 staging API 的两种既有来源。
 * @param url - 已解析的账户地址。
 */
function stagingWalletApi(url: URL) {
  return url.origin === stagingWalletOrigin || url.hostname.endsWith('.api.staging.laiwan.shafayouxi.com');
}

/**
 * 仅本机读取相邻部署文件；缺失或解析不匹配时仍使用统一配置错误。
 */
async function localTestApiToken() {
  if (process.env.CI) return;
  try {
    const deployment = await readFile(resolve(__dirname,
      '../../../../goplay_staging_auto_stack/user_transaction_flask/deploy.yaml'), 'utf8');
    return deploymentToken(deployment);
  } catch {
    // 部署内容或文件路径不能泄漏到报告。
  }
}

/**
 * 只接受 staging Secret 的 stringData 简单标量，不解析任意 YAML。
 * @param deployment - 部署文件内容。
 */
function deploymentToken(deployment: string) {
  const secret = deployment.split(/^---\s*$/m).find(/** 匹配指定命名空间的 Secret。
   * @param document - 一个 YAML 文档。 */ document => [
    /^kind:\s*Secret\s*$/m.test(document), /^\s+name:\s*test-api-token\s*$/m.test(document),
    /^\s+namespace:\s*goplay-staging\s*$/m.test(document),
  ].every(Boolean));
  return secret?.match(/^stringData:\s*\n(?:\s*#.*\n)*\s+token:\s*["']?([A-Za-z0-9_=-]+)["']?\s*$/m)?.[1];
}

/**
 * 检查设置余额响应仍属于目标账号、币种与精确余额。
 * @param result - 业务响应结果。
 * @param userId - 本例创建账号 ID。
 * @param status - 实际状态。
 */
function validateSetBalance(result: any, userId: string, status: number) {
  const balance = setBalanceNumber(result?.balance, status);
  const fields = [...setBalanceIdentity(result, userId), balance === 60];
  assertSetBalanceFields(fields, status);
}

/**
 * 拒绝任一余额契约字段不匹配的响应。
 * @param fields - 独立字段的检查结果。
 * @param status - 实际状态。
 */
function assertSetBalanceFields(fields: boolean[], status: number) {
  if (!fields.every(Boolean)) throw requestFailure('set-creation-diamonds', 'invalid-response', status);
}

/**
 * 转换测试余额并保留类型转换异常的安全分类。
 * @param value - 返回余额字段。
 * @param status - 实际状态。
 */
function setBalanceNumber(value: unknown, status: number) {
  try { return Number(value); }
  catch { throw requestFailure('set-creation-diamonds', 'invalid-response', status); }
}

/**
 * 单独核对余额响应的账号与币种，允许缺失结果转为契约失败。
 * @param result - 响应结果。
 * @param userId - 当前账号 ID。
 */
function setBalanceIdentity(result: any, userId: string) {
  return [result?.wallet_id === userId, result?.currency_name === 'diamond'];
}

/** 读取环境变量中的非空测试令牌。 */
function configuredTestApiToken() { return (process.env.TESTING_API_TOKEN || '').trim(); }
