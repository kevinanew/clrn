import { test, expect } from '@playwright/test';
import { readTestApiToken, setCreationDiamondBalance } from './cases/_shared/test-wallet';

const userId = '11111111-2222-4333-8444-555555555555';
const account = {
  userId,
  accountUrl: `https://api.shafayouxi.org/v11/user/${userId}/account`,
  authorization: 'unused',
};
const originalFetch = globalThis.fetch;
const originalToken = process.env.TESTING_API_TOKEN;
const originalCI = process.env.CI;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of [['TESTING_API_TOKEN', originalToken], ['CI', originalCI]]) {
    if (value === undefined) delete process.env[name!];
    else process.env[name!] = value;
  }
});

test('CI 未配置 token 时明确失败，配置后使用环境变量', async () => {
  process.env.CI = 'true';
  delete process.env.TESTING_API_TOKEN;
  await expect(readTestApiToken()).rejects.toThrow('缺少 TESTING_API_TOKEN');
  process.env.TESTING_API_TOKEN = 'test-only-token';
  expect(await readTestApiToken()).toBe('test-only-token');
});

test('生产域名、伪造 staging 后缀及不匹配钱包在发送请求前被拒绝', async () => {
  /** 记录意外网络调用并抛错，验证无效配置会在请求前被拒绝。 */
  globalThis.fetch = async () => { throw new Error('不应发出请求'); };
  for (const accountUrl of [
    `https://api.laiwan.life/v11/user/${userId}/account`,
    `https://foo.api.staging.laiwan.shafayouxi.com.evil.test/v11/user/${userId}/account`,
    'https://api.shafayouxi.org/v11/user/another-user/account',
  ]) {
    await expect(setCreationDiamondBalance({ ...account, accountUrl }, 'test-only-token'))
      .rejects.toThrow('仅允许 staging');
  }
});

test('设置固定余额使用 X-Testing-Api-Token 请求头，禁止重定向且不发送用户登录凭据', async () => {
  let captured: RequestInit | undefined;
  /**
   * 校验测试接口请求地址与参数，并返回预设成功响应。
   * @param url - 要访问的站点或本机服务地址。
   * @param options - 本次操作的可选配置。
   */
  globalThis.fetch = async (url, options) => {
    expect(url).toBe(`https://api.shafayouxi.org/public/v1/wallet/${userId}/set_balance/testing`);
    captured = options;
    return Response.json({ ok: true, result: { wallet_id: userId, currency_name: 'diamond', balance: '60' } });
  };
  await setCreationDiamondBalance(account, 'test-only-token');
  expect(captured?.method).toBe('POST');
  expect(captured?.redirect).toBe('error');
  expect(captured?.headers).toEqual({ 'Content-Type': 'application/json', 'X-Testing-Api-Token': 'test-only-token' });
  expect(JSON.parse(captured?.body as string)).toEqual({ currency_name: 'diamond', balance: '60' });
});

for (const status of [401, 404, 500]) {
  test(`余额接口 HTTP ${status} 不可被当作成功，响应内容不进入错误`, async () => {
    /** 返回预设 HTTP 或业务响应，验证失败场景不重试且不泄露正文。 */
    globalThis.fetch = async () => new Response('sensitive-response', { status });
    await expect(setCreationDiamondBalance(account, 'test-only-token'))
      .rejects.toThrow(`设置 staging 测试余额失败（HTTP ${status}）`);
  });
}

test('业务失败、错误钱包、币种、余额和非法 JSON 都失败', async () => {
  for (const body of [
    { ok: false },
    { ok: true, result: { wallet_id: 'other', currency_name: 'diamond', balance: '60' } },
    { ok: true, result: { wallet_id: userId, currency_name: 'coin', balance: '60' } },
    { ok: true, result: { wallet_id: userId, currency_name: 'diamond', balance: '0' } },
  ]) {
    /** 返回预设 HTTP 或业务响应，验证失败场景不重试且不泄露正文。 */
    globalThis.fetch = async () => Response.json(body);
    await expect(setCreationDiamondBalance(account, 'test-only-token')).rejects.toThrow('业务响应不符合预期');
  }
  /** 返回无法解析的 JSON，验证接口格式错误会明确失败。 */
  globalThis.fetch = async () => new Response('invalid-json');
  await expect(setCreationDiamondBalance(account, 'test-only-token')).rejects.toThrow('无效 JSON');
});

test('网络错误不泄露底层错误里的 token', async () => {
  /** 模拟携带敏感信息的请求异常，验证对外错误不会泄露凭据。 */
  globalThis.fetch = async () => { throw new Error('sensitive-token'); };
  await expect(setCreationDiamondBalance(account, 'test-only-token'))
    .rejects.toThrow('设置 staging 测试余额请求失败，请检查网络及服务部署');
});
