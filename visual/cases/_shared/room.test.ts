import assert from 'node:assert/strict';
import test from 'node:test';
import { deletePrivateGameRoom } from './room';

const room = { roomId: '11111111-2222-4333-8444-555555555555',
  apiOrigin: 'https://unavailable-regional-proxy.invalid', authorization: 'Bearer test-session' };

test('收尾使用固定 staging 入口删除本轮房间，不依赖客户端地区代理', async context => {
  const requests: { url: unknown; options: RequestInit | undefined }[] = [];
  context.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    requests.push({ url, options });
    return Response.json({ ok: true });
  });
  await deletePrivateGameRoom(room);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.shafayouxi.org/v1/room/${room.roomId}`);
  assert.equal(requests[0].options?.method, 'DELETE');
  assert.deepEqual(requests[0].options?.headers, { Authorization: room.authorization });
  assert.equal(requests[0].options?.redirect, 'error');
  assert.ok(requests[0].options?.signal instanceof AbortSignal);
  await assert.rejects(deletePrivateGameRoom({ ...room, roomId: '../other' }), /有效 UUID/);
  assert.equal(requests.length, 1);
});

test('清理失败不会被当作测试成功', async context => {
  for (const response of [Response.json({ ok: false }), new Response('failed', { status: 503 })]) {
    context.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(deletePrivateGameRoom(room), /本次新建房间应成功解散/);
    context.mock.restoreAll();
  }
});
