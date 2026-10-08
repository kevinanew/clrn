import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { deleteTexasRoom } from './room';

test('删房不依赖已关闭的浏览器/代理，且业务失败必须报错', async () => {
  const roomId = '00000000-0000-4000-8000-000000000001';
  const requests: { method?: string; path?: string; authorization?: string }[] = [];
  let accepted = true;
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: accepted }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const room = { roomId, apiOrigin: `http://127.0.0.1:${address.port}`, authorization: 'Bearer test-only' };
  try {
    await deleteTexasRoom(room);
    assert.deepEqual(requests, [{ method: 'DELETE', path: `/v1/room/${roomId}`,
      authorization: 'Bearer test-only' }]);
    accepted = false;
    await assert.rejects(() => deleteTexasRoom(room), /本次新建德州房间应成功解散/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
