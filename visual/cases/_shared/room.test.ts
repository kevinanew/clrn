import assert from 'node:assert/strict';
import test from 'node:test';
import { deletePrivateGameRoom } from './room';

const room = { roomId: '11111111-2222-4333-8444-555555555555',
  apiOrigin: 'https://unavailable-regional-proxy.invalid', authorization: 'Bearer test-session' };

test('收尾使用固定 staging 入口删除本轮房间，不依赖客户端地区代理', /** 验证收尾使用固定 staging 入口删除本轮房间，不依赖客户端地区代理。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const requests: { url: unknown; options: RequestInit | undefined }[] = [];
  context.mock.method(globalThis, 'fetch', /** 记录房间清理请求并返回有效响应，供请求参数断言使用。
 * @param url - 当前操作使用的 url。
 * @param options - 当前操作使用的 options。 */ async (url: unknown, options?: RequestInit) => {
    requests.push({ url, options });
    return Response.json({ ok: true });
  });
  await deletePrivateGameRoom(room);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.shafayouxi.org/v1/room/${room.roomId}`);
  const options = requests[0].options!;
  assert.equal(options.method, 'DELETE');
  assert.deepEqual(options.headers, { Authorization: room.authorization });
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  await assert.rejects(deletePrivateGameRoom({ ...room, roomId: '../other' }), /有效 UUID/);
  assert.equal(requests.length, 1);
});

test('清理失败不会被当作测试成功', /** 验证清理失败不会被当作测试成功。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  for (const response of [Response.json({ ok: false }), new Response('failed', { status: 503 })]) {
    context.mock.method(globalThis, 'fetch', /** 提供当前预设的房间接口响应。 */ async () => response);
    await assert.rejects(deletePrivateGameRoom(room), new RegExp(`method=DELETE operation=room-delete source=laiwan_proxy status=${response.status} response=received reason=${response.ok ? 'business-rejected' : 'http-error'}`));
    context.mock.restoreAll();
  }
});
