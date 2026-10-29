/** 验证凭据脱敏、节点汇总和截断标记，防止模拟响应被算作真实上游响应。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticFields, diagnosticNode, diagnosticText } from './diagnostic-privacy';
import { DiagnosticRecorder } from './diagnostic-recorder';

test('连接地址与认证参数不进入诊断，节点标签与 Python 保持一致', () => {
  const host = 'api.fixture.invalid';
  const address = `wss://user:password@${host}:9443/private-entry?access_token=secret#credential`;
  const node = diagnosticNode(host);
  assert.equal(node, 'laiwan_prd-d5e6a40756c6', 'Python 代理对同一保留地址也生成此标签');
  assert.match(node, /^laiwan_prd-[a-f0-9]{12}$/);
  assert.equal(diagnosticText(address), node);
  assert.equal(diagnosticNode(address), node);
  assert.equal(diagnosticNode(node), node, '重复清理不能破坏代理节点关联');
  assert.notEqual(diagnosticNode('other.invalid'), node);
  const fields = diagnosticFields({ event: 'http.failed', node: host,
    path: '/public/v1/hall_matching/available.json?token=secret',
    reason: `failed ${address} Bearer secret access_token=other 192.0.2.10:8443 [2001:db8::10]:9443 2001:db8::20 api.fixture.invalid:9443`,
    authorization: 'secret', body: { token: 'secret' }, candidates: [host, address, node],
    before: [host], after: [address], selected: host, excluded: [host] });
  assert.equal(fields.event, 'http.failed');
  assert.equal(fields.path, '/public/v1/hall_matching/available.json');
  assert.equal(fields.node, node);
  assert.deepEqual(fields.candidates, [node, node, node]);
  assert.deepEqual(fields.before, [node]);
  assert.deepEqual(fields.after, [node]);
  assert.equal(fields.selected, node);
  assert.deepEqual(fields.excluded, [node]);
  const result = JSON.stringify(fields);
  for (const value of [host, 'secret', 'password', 'credential', 'other', '192.0.2.10',
    '2001:db8::10', '2001:db8::20', '8443', '9443', '/private-entry']) assert.ok(!result.includes(value), value);
  assert.ok(!('body' in fields));
});

test('区分候选、真实健康响应、模拟响应、缓存和 WebSocket 尝试', () => {
  const recorder = new DiagnosticRecorder();
  recorder.record('nodes.received', { candidates: ['A', 'B', 'C'] });
  recorder.record('http.start', { node: 'A', method: 'GET', path: '/node/v1/status' });
  recorder.record('proxy.response', { node: 'A', method: 'GET', path: '/node/v1/status', source: 'upstream' });
  recorder.record('http.start', { node: 'B', method: 'GET', path: '/node/v1/status' });
  recorder.record('proxy.response', { node: 'B', method: 'GET', path: '/node/v1/status', source: 'fixture' });
  recorder.record('probe.cache', { node: 'B', source: 'application', cacheAgeMs: 2000 });
  recorder.record('websocket.start', { node: 'A' });
  const summary = recorder.markdown('case');
  assert.match(summary, new RegExp(`\\| ${diagnosticNode('A')} \\| 1 \\| 1 \\| 0 \\| 0 \\| 1 \\|`));
  assert.match(summary, new RegExp(`\\| ${diagnosticNode('B')} \\| 1 \\| 0 \\| 1 \\| 1 \\| 0 \\|`));
  assert.match(summary, new RegExp(`\\| ${diagnosticNode('C')} \\| 0 \\| 0 \\| 0 \\| 0 \\| 0 \\|`));
  assert.match(summary, /已采集应用选线与缓存决策/);
  assert.match(new DiagnosticRecorder().markdown('old build'), /无法确定/);
});

test('容量有限并显示截断，时间线按采集时间排序', () => {
  const recorder = new DiagnosticRecorder();
  for (let index = 0; index < 5002; index++) recorder.record('probe.start', { observedAt: 9000 - index });
  const result = recorder.snapshot();
  assert.equal(result.dropped, 2);
  assert.equal(result.events.length, 5000);
  assert.ok(result.events[0].observedAt < result.events.at(-1)!.observedAt);
});


test('合并旧代理历史不会挤掉最新的浏览器失败现场', () => {
  const recorder = new DiagnosticRecorder();
  recorder.record('test.failure', { observedAt: 10000, reason: '连接失败' });
  recorder.merge(Array.from({ length: 5000 }, (_, index) => ({ event: 'proxy.request', observedAt: index })));
  assert.equal(recorder.snapshot().events.at(-1)?.event, 'test.failure');
  assert.equal(recorder.dropped, 1);
});
