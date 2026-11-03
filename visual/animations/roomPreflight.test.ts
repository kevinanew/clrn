import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completedRoomPreflight, type ProxySnapshot } from './roomPreflight';

const before: ProxySnapshot = { events: [{ event: 'proxy.request', requestId: 'earlier' }], dropped: 0 };
const request = { event: 'proxy.request', requestId: 'preflight', path: '/v3/pay_action/do',
  method: 'OPTIONS', source: 'upstream' };
const response = { ...request, event: 'proxy.response', status: 204 };

/**
 * 构造一次建房期间完整保留的代理事件。
 * @param events - 本次新增事件。
 */
function snapshot(...events: unknown[]): ProxySnapshot {
  return { events: [...before.events, ...events], dropped: 0 };
}

test('真实预检结束且没有建房写入时允许恢复入口', () => {
  assert.equal(completedRoomPreflight(before, snapshot(request, response)), true);
  // 表单价格等读取可能使用 RPC；提交前已结束的操作不属于这次建房写入。
  const history = { ...before, events: [...before.events,
    { event: 'proxy.websocket-command', messageType: 'rpc' }] };
  assert.equal(completedRoomPreflight(history,
    { ...history, events: [...history.events, request, response] }), true);
});

test('建房写入结果不明或已返回时均禁止重新创建', () => {
  for (const event of ['proxy.request', 'proxy.response', 'proxy.error']) {
    assert.equal(completedRoomPreflight(before, snapshot(request, response,
      { ...request, event, method: 'POST', requestId: 'creation' })), false);
  }
  assert.equal(completedRoomPreflight(before, snapshot(request, response,
    { event: 'proxy.websocket-command', messageType: 'rpc' })), false);
});

test('预检未完成、失败、来自夹具或响应无法关联时禁止重试', () => {
  for (const events of [[], [request], [response], [request, { ...response, status: 403 }],
    [request, { ...response, requestId: 'other' }], [request, { ...response, source: 'fixture' }],
    [{ ...request, requestId: 'pending' }, request, response]]) {
    assert.equal(completedRoomPreflight(before, snapshot(...events)), false);
  }
});

test('代理记录丢失或基线不一致时禁止重试', () => {
  const after = snapshot(request, response);
  assert.equal(completedRoomPreflight({ ...before, dropped: 1 }, after), false);
  assert.equal(completedRoomPreflight(before, { ...after, dropped: 1 }), false);
  assert.equal(completedRoomPreflight(before, { ...after, events: [request, response] }), false);
});
