/** 验证凭据脱敏、节点汇总和截断标记，防止模拟响应被算作真实上游响应。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticFields, diagnosticNode, diagnosticText } from './diagnostic-privacy';
import { DiagnosticRecorder } from './diagnostic-recorder';

test('地址和错误文本不暴露共享域名、用户信息和认证参数', () => {
  const address = 'wss://user:password@64.kr-seoul.api.staging.laiwan.shafayouxi.com/socket?access_token=secret#credential';
  assert.equal(diagnosticText(address), 'wss://64.kr-seoul.api.staging.laiwan/socket');
  assert.equal(diagnosticNode(address), '64.kr-seoul.api.staging.laiwan');
  const fields = diagnosticFields({ event: 'error', reason: `failed ${address} Bearer secret access_token=other`,
    authorization: 'secret', body: { token: 'secret' }, candidates: ['64.kr-seoul.api.staging.laiwan.shafayouxi.com'] });
  const result = JSON.stringify(fields);
  for (const value of ['secret', 'password', 'credential', 'other', 'shafayouxi.com']) assert.ok(!result.includes(value), result);
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
  assert.match(summary, /\| A \| 1 \| 1 \| 0 \| 0 \| 1 \|/);
  assert.match(summary, /\| B \| 1 \| 0 \| 1 \| 1 \| 0 \|/);
  assert.match(summary, /\| C \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
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
