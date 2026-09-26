import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Session } from './auth';

const stagingWalletOrigin = 'https://api.shafayouxi.org';

/** CI 使用 Secret；本机可直接复用相邻 staging 部署仓库中的共用 Secret。 */
export async function readTestApiToken(): Promise<string> {
  const configured = process.env.TEST_API_TOKEN?.trim();
  if (configured) return configured;
  if (!process.env.CI) {
    try {
      const deployment = await readFile(resolve(__dirname,
        '../../../../goplay_staging_auto_stack/user_transaction_flask/deploy.yaml'), 'utf8');
      const secret = deployment.split(/^---\s*$/m).find(document =>
        /^kind:\s*Secret\s*$/m.test(document)
        && /^\s+name:\s*test-api-token\s*$/m.test(document)
        && /^\s+namespace:\s*goplay-staging\s*$/m.test(document));
      // 只接受部署文件当前使用的 stringData 简单标量，不解析任意 YAML。
      const token = secret?.match(/^stringData:\s*\n(?:\s*#.*\n)*\s+token:\s*["']?([A-Za-z0-9_=-]+)["']?\s*$/m)?.[1];
      if (token) return token;
    } catch {
      // 文件缺失时提供统一配置提示，不将部署内容写入报告。
    }
  }
  throw new Error('缺少 TEST_API_TOKEN；请配置环境变量或本机相邻 staging 部署文件的 test-api-token Secret');
}

/** 仅为已验证登录的 staging 创建专用账号设置钻石，不通过浏览器发送管理 token。 */
export async function setCreationDiamondBalance(account: Session, token: string): Promise<void> {
  const url = new URL(account.accountUrl);
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || !(url.origin === stagingWalletOrigin || url.hostname.endsWith('.api.staging.laiwan.shafayouxi.com'))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.userId)
    || url.pathname !== `/v11/user/${account.userId}/account`) {
    throw new Error('设置测试余额仅允许 staging 创建账号的钱包');
  }
  let response: Response;
  try {
    response = await fetch(`${stagingWalletOrigin}/public/v1/wallet/${account.userId}/set_balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, currency_name: 'diamond', balance: '60' }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('设置 staging 测试余额请求失败，请检查网络及服务部署');
  }
  if (!response.ok) throw new Error(`设置 staging 测试余额失败（HTTP ${response.status}）`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('设置 staging 测试余额返回无效 JSON');
  }
  if (body?.ok !== true || body.result?.wallet_id !== account.userId
    || body.result?.currency_name !== 'diamond' || Number(body.result?.balance) !== 60) {
    throw new Error('设置 staging 测试余额的业务响应不符合预期');
  }
}
