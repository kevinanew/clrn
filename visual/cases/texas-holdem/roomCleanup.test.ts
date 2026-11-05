import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { deleteTexasRoom } from './room';

test('删房不依赖已关闭的浏览器/代理，且业务失败必须报错', /** 验证删房不依赖已关闭的浏览器/代理，且业务失败必须报错。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const roomId = '00000000-0000-4000-8000-000000000001';
  const requests: { method?: string; path?: string; authorization?: string }[] = [];
  let accepted = true;
  let status = 200;
  const server = createServer(/** 记录本机房间清理请求，并返回指定状态与业务结果。
 * @param req - 当前 HTTP 请求。
 * @param res - 当前 HTTP 响应。 */ (req, res) => {
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = status;
    res.end(JSON.stringify({ ok: accepted }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const room = { roomId, apiOrigin: 'https://unavailable-regional-proxy.invalid', authorization: 'Bearer test-only' };
  const realFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', /** 核对真实删除房间地址后将请求转发到本机测试服务。
 * @param input - 当前操作使用的 input。
 * @param options - 当前操作使用的 options。 */ async (input: string, options?: RequestInit) => {
    assert.equal(input, `https://api.shafayouxi.org/v1/room/${roomId}`);
    return realFetch(`http://127.0.0.1:${address.port}/v1/room/${roomId}`, options);
  });
  try {
    await deleteTexasRoom(room);
    assert.deepEqual(requests, [{ method: 'DELETE', path: `/v1/room/${roomId}`,
      authorization: 'Bearer test-only' }]);
    accepted = false;
    await assert.rejects(/** 执行业务拒绝的房间删除，验证 HTTP 200 不会被误报为清理成功。 */ () => deleteTexasRoom(room), /operation=room-delete .*status=200 .*reason=business-rejected/);
    status = 401;
    await assert.rejects(/** 执行会返回失败状态的房间删除，验证清理不会误报成功。 */ () => deleteTexasRoom(room), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /operation=room-delete .*status=401 .*reason=http-error/);
      assert.ok(!error.message.includes(room.authorization));
      return true;
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
});
