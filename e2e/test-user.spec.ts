import { test, expect } from '@playwright/test';
import { createTestingAccount } from './cases/_shared/test-user';

const originalFetch = globalThis.fetch;
const credentials = { username: 'testuser123', password: 'password123' };
const userId = '11111111-2222-4333-8444-555555555555';

test.afterEach(() => { globalThis.fetch = originalFetch; });

test('测试注册使用专用请求头和用户名密码，不发送设备信息且禁止重定向', async () => {
  globalThis.fetch = async (url, options) => {
    expect(url).toBe('https://api.shafayouxi.org/public/v1/user/register/username_password/testing');
    expect(options?.method).toBe('POST');
    expect(options?.redirect).toBe('error');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json', 'X-Testing-Api-Token': 'test-token' });
    expect(JSON.parse(options?.body as string)).toEqual(credentials);
    return Response.json({ ok: true, result: { user_id: userId, username: credentials.username } });
  };
  expect(await createTestingAccount(credentials, 'test-token')).toEqual({ userId, username: credentials.username });
});

test('空 token 在发送请求前失败', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('不应请求'); };
  await expect(createTestingAccount(credentials, '  ')).rejects.toThrow('缺少 TESTING_API_TOKEN');
  expect(calls).toBe(0);
});

for (const status of [401, 404, 500]) {
  test(`注册 HTTP ${status} 明确失败且不重试`, async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('sensitive', { status }); };
    await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow(`创建 staging 测试账号失败（HTTP ${status}）`);
    expect(calls).toBe(1);
  });
}

test('拒绝业务失败、错误账号及非法 JSON，错误不包含凭据', async () => {
  for (const body of [
    { ok: false, error_type: 'username_already_register' },
    { ok: true, result: { user_id: userId, username: 'another' } },
    { ok: true, result: { user_id: 'invalid', username: credentials.username } },
  ]) {
    globalThis.fetch = async () => Response.json(body);
    await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow('业务响应不符合预期');
  }
  globalThis.fetch = async () => new Response('invalid-json');
  await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow('无效 JSON');
  globalThis.fetch = async () => { throw new Error('sensitive-token'); };
  await expect(createTestingAccount(credentials, 'test-token')).rejects.toThrow('创建 staging 测试账号请求失败；不会自动重试');
});
