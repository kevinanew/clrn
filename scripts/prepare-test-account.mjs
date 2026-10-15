import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const stagingOrigin = 'https://api.shafayouxi.org';
export const initialCoinBalance = '10000';

/**
 * 从环境或本机 staging 部署文件读取测试令牌，持续集成禁止回退到文件。
 * @param environment - 当前进程的环境配置。
 * @param deploymentFile - 本机共用 staging Secret 所在文件。
 */
export async function readTestingApiToken(environment = process.env,
  deploymentFile = new URL('../../goplay_staging_auto_stack/user_transaction_flask/deploy.yaml', import.meta.url)) {
  const configured = environment.TESTING_API_TOKEN?.trim();
  if (configured) return configured;
  if (!environment.CI && environment.GITHUB_ACTIONS !== 'true') {
    try {
      const deployment = await readFile(deploymentFile, 'utf8');
      const secret = deployment.split(/^---\s*$/m).find(document =>
        /^kind:\s*Secret\s*$/m.test(document)
        && /^\s+name:\s*test-api-token\s*$/m.test(document)
        && /^\s+namespace:\s*goplay-staging\s*$/m.test(document));
      const token = secret?.match(/^stringData:\s*\n(?:\s*#.*\n)*\s+token:\s*["']?([A-Za-z0-9_=-]+)["']?\s*$/m)?.[1];
      if (token) return token;
    } catch {
      // 只报告缺少配置，不输出部署文件或底层错误中的凭据。
    }
  }
  throw new Error('缺少 TESTING_API_TOKEN，无法准备测试账号金币余额');
}

/**
 * 只请求固定 staging 入口；拒绝重定向，所有失败均保留阶段且去除敏感正文。
 * @param path - 固定业务路径。
 * @param method - 请求方法。
 * @param body - 请求 JSON 数据。
 * @param headers - 当前接口所需的认证头。
 * @param stage - 不含凭据的阶段描述。
 */
async function requestJson(path, method, body, headers, stage) {
  let response;
  try {
    response = await fetch(`${stagingOrigin}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${stage}请求失败`);
  }
  if (!response.ok) throw new Error(`${stage}失败（HTTP ${response.status}）`);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`${stage}返回无效 JSON`);
  }
  if (result?.ok !== true || !result.result) throw new Error(`${stage}业务响应失败`);
  return result.result;
}

/**
 * 在账号独占锁内、启动客户端前设置固定金币，再通过真实钱包接口核对。
 * 此准备会创建短期登录会话，客户端仍需完成正常初始化及真实登录。
 * @param account - 本任务已独占账号的用户名、密码及可选的已登记用户 ID。
 * @param token - 仅在 Node 进程使用的测试接口令牌。
 */
export async function prepareTestAccountCoins(account, token) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('缺少 TESTING_API_TOKEN');
  if (typeof account?.username !== 'string' || !/^[a-zA-Z0-9.]{6,30}$/.test(account.username)
    || typeof account.password !== 'string' || !account.password || account.password.length > 20
    || /[\r\n\0]/.test(account.password)) throw new Error('测试账号凭据无效');
  const session = await requestJson('/public/v10/user/login/username/password', 'POST', {
    username: account.username, password: account.password, device_id: randomUUID(),
  }, {}, '准备账号登录');
  const userId = session.user_id;
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    || session.username !== account.username || (account.userId !== undefined && account.userId !== userId)
    || !/^Bearer$/i.test(session.api_token?.token_type)
    || typeof session.api_token.access_token !== 'string' || !session.api_token.access_token
    || /[\r\n]/.test(session.api_token.access_token)) throw new Error('准备账号登录返回身份或会话不符');
  const result = await requestJson(`/public/v1/wallet/${userId}/set_balance/testing`, 'POST', {
    currency_name: 'coin', balance: initialCoinBalance,
  }, { 'X-Testing-Api-Token': token }, '设置测试金币');
  if (result.wallet_id !== userId || result.currency_name !== 'coin'
    || Number(result.balance) !== Number(initialCoinBalance)) throw new Error('设置测试金币返回钱包、币种或余额不符');
  const wallet = await requestJson(`/v10/wallet/${userId}`, 'PUT', { currencies: ['coin'] }, {
    Authorization: `${session.api_token.token_type} ${session.api_token.access_token}`,
  }, '核对测试金币');
  const coins = Array.isArray(wallet.currencies) ? wallet.currencies.filter(currency => currency?.code === 'coin') : [];
  if (coins.length !== 1 || Number(coins[0].balance) !== Number(initialCoinBalance)) {
    throw new Error('核对测试金币失败，实际余额不是 10000');
  }
}
