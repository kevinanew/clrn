import { test, expect } from './helpers/diagnostic-test';
import { createTestingAccount } from './cases/_shared/test-user';
import { requestFailure } from '../scripts/request-failure.cjs';

const originalFetch = globalThis.fetch;
const credentials = { username: 'testuser123', password: 'password123' };
const userId = '11111111-2222-4333-8444-555555555555';

test.afterEach(/** 每个账号创建用例结束后恢复真实 fetch 接口。 */ () => { globalThis.fetch = originalFetch; });

test('测试注册使用专用请求头和用户名密码，不发送设备信息且禁止重定向', /** 验证测试注册使用专用请求头和用户名密码，不发送设备信息且禁止重定向。 */ async () => {
  /**
   * 校验测试接口请求地址与参数，并返回预设成功响应。
   * @param url - 要访问的站点或本机服务地址。
   * @param options - 本次操作的可选配置。
   */
  globalThis.fetch = /** 核对创建测试账号请求的地址、方法、重定向策略与请求体。
 * @param url - 当前操作使用的 url。
 * @param options - 当前操作使用的 options。 */ async (url, options) => {
    expect(url).toBe('https://api.shafayouxi.org/public/v10/user/register/username_password/testing');
    expect(options?.method).toBe('POST');
    expect(options?.redirect).toBe('error');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json', 'X-Testing-Api-Token': 'test-token' });
    expect(JSON.parse(options?.body as string)).toEqual(credentials);
    return Response.json({ ok: true, result: { user_id: userId, username: credentials.username } });
  };
  expect(await createTestingAccount(credentials, 'test-token')).toEqual({ userId, username: credentials.username });
});

test('空 token 在发送请求前失败', /** 验证空 token 在发送请求前失败。 */ async () => {
  let calls = 0;
  /** 记录意外网络调用并抛错，验证无效配置会在请求前被拒绝。 */
  globalThis.fetch = /** 若无效参数触发网络请求则立即失败，验证本地参数校验。 */ async () => { calls++; throw new Error('不应请求'); };
  await expect(createTestingAccount(credentials, '  ')).rejects.toThrow('缺少 TESTING_API_TOKEN');
  expect(calls).toBe(0);
});

for (const status of [401, 404, 500]) {
  test(`注册 HTTP ${status} 明确失败且不重试`, /** 验证注册 HTTP $\{status\} 明确失败且不重试。 */ async () => {
    let calls = 0;
    /** 返回预设 HTTP 或业务响应，验证失败场景不重试且不泄露正文。 */
    globalThis.fetch = /** 统计请求并返回指定失败状态，验证账号创建错误处理。 */ async () => { calls++; return new Response('sensitive', { status }); };
    await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow(requestFailure('create-test-account', 'http-error', status).message);
    expect(calls).toBe(1);
  });
}

test('拒绝业务失败、错误账号及非法 JSON，错误不包含凭据', /** 验证拒绝业务失败、错误账号及非法 JSON，错误不包含凭据。 */ async () => {
  for (const [body, reason] of [
    [{ ok: false, error_type: 'username_already_register' }, 'business-rejected'],
    [{ ok: true, result: { user_id: userId, username: 'another' } }, 'invalid-response'],
    [{ ok: true, result: { user_id: 'invalid', username: credentials.username } }, 'invalid-response'],
  ] as const) {
    /** 返回预设 HTTP 或业务响应，验证失败场景不重试且不泄露正文。 */
    globalThis.fetch = /** 返回当前预设的账号响应正文，覆盖不同业务结构。 */ async () => Response.json(body);
    await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow(requestFailure('create-test-account', reason, 200).message);
  }
  /** 返回无法解析的 JSON，验证接口格式错误会明确失败。 */
  globalThis.fetch = /** 提供无效 JSON，验证账号接口的解析失败诊断。 */ async () => new Response('invalid-json');
  await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow(requestFailure('create-test-account', 'invalid-json', 200).message);
  /** 模拟携带敏感信息的请求异常，验证对外错误不会泄露凭据。 */
  globalThis.fetch = /** 注入含敏感令牌的请求错误，验证失败信息脱敏。 */ async () => { throw new Error('sensitive-token'); };
  await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow(requestFailure('create-test-account', 'request-failed').message);
});
