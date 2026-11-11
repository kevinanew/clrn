/** 验证代理处理早于浏览器回复时，观察器不会提前允许采样。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Page } from '@playwright/test';
import { observeSlotSpinReplies } from './slotSpin';

test('旋转回复按连接和请求编号匹配，不把心跳、能量读取和无关帧当成完成', /** 模拟同号跨连接回复、延迟回复和重复帧。 */ () => {
  const page = new EventEmitter();
  const replies = observeSlotSpinReplies(page as unknown as Page);
  const sockets = [new EventEmitter(), new EventEmitter()];
  for (const socket of sockets) page.emit('websocket', socket);
  sockets[0].emit('framesent', { payload: 'invalid\nnull\n' + JSON.stringify({ id: 1, method: 9,
    params: { data: { path: '/v2/slot_machine/user/test/spin' } } }) });
  assert.equal(replies.received(), 0, '代理已处理请求但浏览器尚未收到时不能开始采样');
  sockets[1].emit('framereceived', { payload: '{"id":1,"result":{}}' });
  sockets[0].emit('framereceived', { payload: '{"id":7,"result":{}}' });
  assert.equal(replies.received(), 0);
  sockets[0].emit('framereceived', { payload: '{"id":1,"result":{}}\n{"id":1,"result":{}}' });
  assert.equal(replies.received(), 1, '同一请求最多完成一次');
  sockets[0].emit('framesent', { payload: '{"id":2,"method":7}\n' + JSON.stringify({ id: 3, method: 9,
    params: { data: { path: '/v2/slot_machine/user/test/energy' } } }) });
  sockets[0].emit('framereceived', { payload: '{"id":2,"result":{}}\n{"id":3,"result":{}}' });
  assert.equal(replies.received(), 1);
});
