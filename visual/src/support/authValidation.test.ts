/** 验证序列化认证读取与账户隔离边界，避免拆分函数后接受损坏缓存或错配令牌。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { Page } from '@playwright/test';
import { isSignedIn, waitForSignInState } from './authValidation';

const complete = { user_id: 'visual-user', api_token: { access_token: 'token', token_type: 'Bearer' } };

/** 用独立浏览器全局执行真实 evaluate 回调，测试序列化不依赖宿主函数。
 * @param raw - 当前缓存读取器。
 * @param get - 账户请求边界。 */
function authPage(raw: () => string | null, get: (...args: any[]) => Promise<unknown>): Page {
  return {
    /** 仅执行序列化后的页面函数。
     * @param callback - 页面读取函数。
     * @param argument - 存储键。 */
    async evaluate(callback: (key: string) => unknown, argument: string) {
      return runInNewContext(`(${callback.toString()})(key)`, { key: argument, window: { localStorage: { getItem: raw } } });
    },
    request: { get },
    /** 保留异步轮询，使请求完成后观察器能正常结束。
     * @param _milliseconds - 正式轮询等待时间。 */
    async waitForTimeout(_milliseconds: number) {
      await new Promise(/** 下一轮事件循环完成缓存轮询。
       * @param resolve - 等待完成通知。 */ resolve => setTimeout(resolve, 0));
    },
  } as unknown as Page;
}

for (const raw of [null, '', '{', 'null', '0', '"text"', '{}',
  JSON.stringify({ ...complete, user_id: '   ' }),
  JSON.stringify({ ...complete, user_id: 1 }),
  JSON.stringify({ ...complete, api_token: { access_token: 'token' } }),
  JSON.stringify({ ...complete, api_token: { access_token: [], token_type: 'Bearer' } }),
]) {
  test(`损坏或不完整缓存 ${raw} 不触发账户请求`, /** 必须先验证完整的字符串身份字段。 */ async () => {
    const page = authPage(/** 返回当前无效缓存。 */ () => raw,
      /** 无效缓存不允许发出请求。 */ async () => { assert.fail('无效缓存不能请求账户接口'); });
    assert.equal(await isSignedIn(page), false);
    assert.equal(await waitForSignInState(page), 'signedOut');
  });
}

test('认证字段去除首尾空白后发送真实账户定位和认证头', /** 缓存解析和请求参数之间保持同一身份。 */ async () => {
  const raw = JSON.stringify({ user_id: ' visual/user ', api_token: { access_token: ' token ', token_type: ' Bearer ' } });
  const page = authPage(/** 返回含空白的完整缓存。 */ () => raw,
    /** 检查真实请求参数，不替换认证实现。
     * @param url - 账户 URL。
     * @param options - 真实请求选项。 */ async (url, options) => {
      assert.equal(url, 'http://account.test/v11/user/visual%2Fuser/account');
      assert.equal(options.headers.Authorization, 'Bearer token');
      assert.equal(options.timeout, 1234);
      return { status: /** 返回真实边界状态。 */ () => 200 };
    });
  assert.equal(await isSignedIn(page), true);
  assert.equal(await waitForSignInState(page, { apiBaseUrl: 'http://account.test/', requestTimeoutMs: 1234 }), 'signedIn');
});

for (const after of [
  { ...complete, user_id: 'other-user' },
  { ...complete, api_token: { ...complete.api_token, access_token: 'other-token' } },
  { ...complete, api_token: { ...complete.api_token, token_type: 'Other' } },
]) {
  test(`账户校验期间缓存变化 ${JSON.stringify(after)} 必须拒绝`, /** 账户、令牌或类型变更均不能接受旧响应。 */ async () => {
    let raw = JSON.stringify(complete);
    const page = authPage(/** 读取当前缓存。 */ () => raw,
      /** 模拟请求等待期间身份变化。 */ async () => {
        raw = JSON.stringify(after);
        return { status: /** 原账户请求仍成功。 */ () => 200 };
      });
    await assert.rejects(waitForSignInState(page), /账户接口校验期间登录缓存已变更/);
  });
}
