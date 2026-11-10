/** 验证控制正文序列化失败仍通过 Promise 传播，不发起请求。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Mitmproxy } from './mitmproxy-client';

test('循环控制正文返回拒绝的 Promise，调用本身不抛出同步错误', /** 保留控制客户端原有的异步错误契约。 */ async () => {
  const payload: Record<string, unknown> = {};
  payload.self = payload;
  const result = new Mitmproxy(1, 'offline-test').command('scenario', payload);
  assert.ok(result instanceof Promise);
  await assert.rejects(result, TypeError);
});
