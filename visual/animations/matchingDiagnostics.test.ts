/** 诊断必须按连接关联且不持久化业务或认证正文。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Page } from '@playwright/test';
import { observeMatchingReplies } from './matchingDiagnostics';

test('匹配诊断区分发送、同连接回复、失败及关闭，不保存正文', /** 验证跨连接、隐私及容量边界。 */ () => {
  const page = new EventEmitter();
  const observer = observeMatchingReplies(page as unknown as Page);
  const sockets = [new EventEmitter(), new EventEmitter()];
  for (const socket of sockets) page.emit('websocket', socket);
  const send = /** 发出含敏感诱饵的模拟 RPC。
   * @param socket - 模拟连接。
   * @param id - 命令编号。
   * @param path - 命令路径。 */ (socket: EventEmitter, id: number, path: string) => socket.emit('framesent', {
    payload: JSON.stringify({ id, method: 9, params: { data: { path, token: 'synthetic-secret' } } }),
  });
  send(sockets[0], 1, '/v1/hall_matching/quit');
  sockets[0].emit('framesent', { payload: 'invalid\nnull\n42' });
  send(sockets[0], 2, '/unrelated/synthetic-secret');
  send(sockets[0], 3, '/v1/hall_matching/quit?token=synthetic-secret');
  sockets[1].emit('framereceived', { payload: '{"id":1,"result":{"data":{"ok":true}}}' });
  assert.equal(observer.snapshot().events.filter(/** 只选择已关联回复。
   * @param event - 诊断事件。 */ event => event.event === 'reply').length, 0);
  sockets[0].emit('framereceived', { payload: JSON.stringify({ id: 1,
    result: { data: { ok: false, error: 'synthetic-secret' } } }) });
  sockets[0].emit('framereceived', { payload: '{"id":1,"result":{"data":{"ok":true}}}' });
  send(sockets[0], 4, '/v1/hall_matching/join');
  sockets[0].emit('framereceived', { payload: '{"id":4,"error":{"message":"synthetic-secret"}}' });
  send(sockets[0], 5, '/v1/hall_matching/keep_waiting');
  sockets[0].emit('framereceived', { payload: '{"id":5,"result":{"data":{"ok":true}}}' });
  sockets[0].emit('socketerror', 'synthetic-secret');
  sockets[0].emit('close');
  const snapshot = observer.snapshot();
  assert.deepEqual(snapshot.events.filter(/** 只选择已关联回复。
   * @param event - 诊断事件。 */ event => event.event === 'reply').map(/** 比较固定结果分类。
   * @param event - 诊断事件。 */ event => event.outcome),
    ['business-error', 'protocol-error', 'success']);
  assert.equal(snapshot.events.at(-1)?.event, 'socket-close');
  assert.ok(!JSON.stringify(snapshot).includes('synthetic-secret'));
  for (let id = 10; id < 400; id++) send(sockets[0], id, '/v1/hall_matching/quit');
  assert.equal(observer.snapshot().events.length, 200);
  assert.ok(observer.snapshot().dropped > 0);
});
