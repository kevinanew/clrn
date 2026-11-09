/** 房间账号与钱包边界回归，不访问真实账号或网络。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIRequestContext, Page } from '@playwright/test';
import { createPrivateGameRoom, ensureRoomBalance } from './room';

const account = { userId: '11111111-2222-4333-8444-555555555555', username: 'unapproved-account', authorization: 'Bearer private-test-token' };

/**
 * 提供只读余额响应并记录参数和资源释放。
 * @param body - 本轮接口正文。
 * @param status - 本轮 HTTP 状态。
 */
function wallet(body: unknown, status = 200) {
  let disposed = 0;
  const request = {
    /**
     * 核对真实钱包请求参数，返回内存响应。
     * @param url - 钱包读取地址。
     * @param options - 原有认证和币种配置。
     */
    async put(url: string, options: unknown) {
      assert.equal(url, `https://api.shafayouxi.org/v10/wallet/${account.userId}`);
      assert.deepEqual(options, { headers: { Authorization: account.authorization }, data: { currencies: ['diamond'] } });
      return {
        /** 返回原有 HTTP 判断。 */ ok: () => status < 400,
        /** 返回实际状态。 */ status: () => status,
        /** 返回接口正文。 */ json: async () => body,
        /** 记录响应释放。 */ dispose: async () => { disposed++; },
      };
    },
  } as unknown as APIRequestContext;
  return { request, /** 核对所有读取路径都释放响应。 */ verify: () => assert.equal(disposed, 1) };
}

for (const [currencies, expected] of [
  [[{ code: 'coin', balance: '100' }, { code: 'diamond', balance: '10' }], ''],
  [[{ code: 'diamond', balance: '9' }], '仅允许'],
  [[{ code: 'diamond', balance: 'not-a-number' }], 'invalid-response'],
  [[{ code: 'coin', balance: '100' }], 'invalid-response'],
  [null, 'invalid-response'],
] as const) {
  test(`余额读取保持币种验证、补钻隔离和资源释放：${JSON.stringify(currencies)}`, /** 核对钱包边界。 */ async () => {
    const { request, verify } = wallet({ ok: true, result: { currencies } });
    const result = ensureRoomBalance(request, account);
    if (expected) await assert.rejects(result, new RegExp(expected));
    else await result;
    verify();
  });
}

for (const [body, status, reason] of [[{ ok: false }, 200, 'business-rejected'], [{ ok: true }, 503, 'http-error']] as const) {
  test(`余额失败保留实际状态并释放响应：${status}/${reason}`, /** HTTP 或业务失败不可静默成功。 */ async () => {
    const { request, verify } = wallet(body, status);
    await assert.rejects(ensureRoomBalance(request, account), new RegExp(`operation=room-read-diamonds .*status=${status} .*reason=${reason}`));
    verify();
  });
}

const valid = { user_id: account.userId, username: 'private-test-user', api_token: { access_token: 'private-test-token', token_type: 'Bearer' } };
for (const raw of [null, '', '{private-invalid-json', 'null', JSON.stringify({ ...valid, user_id: 'invalid' }),
  JSON.stringify({ ...valid, api_token: {} }), JSON.stringify({ ...valid, username: '' })]) {
  test(`无效会话在建房前被拒绝：${raw}`, /** 账号验证失败不能进入表单或钱包请求。 */ async () => {
    const page = { /** 读取本例页面缓存。 */ evaluate: async () => raw } as unknown as Page;
    await assert.rejects(createPrivateGameRoom(page, /** 无效账号不能登记房间。 */ () => assert.fail('不应建房'), 'texas_react_native'),
      /operation=room-read-session .*reason=invalid-response/);
  });
}
