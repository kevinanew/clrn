/** 服务生命周期记录与真实文件流失败的隔离回归；不调用任何业务地址。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { observeReleaseConnection, observeReleaseResponse, releaseDiagnosticWriter, releaseDiagnosticDirectory } from './release-diagnostics.mjs';
import { startReleaseWebServer } from './release-web-server.mjs';

const secret = 'https://release.invalid:9443/private?token=synthetic-token Bearer synthetic-secret';
const privacyServerId = '00009443-0000-4000-8000-000000000000';
const uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const privacyFields = {
  event: /^release\.[a-z-]+$/, source: /^release-static$/,
  serverId: new RegExp(`^${uuidPattern}$`), requestId: new RegExp(`^${uuidPattern}-[1-9][0-9]*$`),
  connectionId: /^connection-[1-9][0-9]*$/, observedAt: /^[0-9]+$/, elapsedMs: /^[0-9]+$/,
  operation: /^release-static-(connect|read)$/, outcome: /^(observed|error|closed)$/,
  method: /^(GET|HEAD|POST|PUT|DELETE|OPTIONS|OTHER)$/, status: /^([1-5][0-9]{2}|unavailable)$/,
  response: /^(sent|not-sent)$/, keepAliveTimeoutMs: /^[0-9]+$/, keepAliveTimeoutBufferMs: /^([0-9]+|unavailable)$/,
};
const numericPrivacyFields = new Set(['observedAt', 'elapsedMs', 'status', 'keepAliveTimeoutMs', 'keepAliveTimeoutBufferMs']);

/**
 * 每类事件仅允许自己的固定字段，地址、端口、路径与原始异常字段均不能进入日志。
 * @param eventName - 生命周期事件名。
 * @returns 该事件在公共字段之外允许的字段。
 */
function specificPrivacyFields(eventName) {
  if (eventName === 'release.listen') return ['keepAliveTimeoutMs', 'keepAliveTimeoutBufferMs'];
  if (['release.tcp-open', 'release.tcp-end', 'release.tcp-timeout', 'release.tcp-error', 'release.tcp-close'].includes(eventName)) {
    return ['connectionId', 'operation', 'elapsedMs', 'outcome'];
  }
  assert.ok(['release.request', 'release.finish', 'release.close', 'release.interrupted', 'release.response-error',
    'release.stream-open', 'release.stream-end', 'release.stream-error', 'release.stream-close', 'release.file-unavailable'].includes(eventName));
  return ['requestId', 'connectionId', 'operation', 'elapsedMs', 'method', 'status', 'response'];
}

/**
 * 按字段校验日志结构与值；合法编号和时间包含端口数字时不构成泄露。
 * @param events - 内存或持久化后读取的生命周期事件。
 */
function verifyPrivacy(events) {
  for (const event of events) {
    const fields = ['event', 'observedAt', 'source', 'serverId', ...specificPrivacyFields(event.event)];
    assert.deepEqual(Object.keys(event).sort(), fields.sort());
    for (const [field, value] of Object.entries(event)) {
      const expectedType = numericPrivacyFields.has(field) && value !== 'unavailable' ? 'number' : 'string';
      assert.equal(typeof value, expectedType, field);
      assert.match(String(value), privacyFields[field], field);
    }
  }
  const output = JSON.stringify(events);
  for (const value of ['release.invalid', '/private', 'synthetic-', '127.0.0.1']) assert.ok(!output.includes(value), value);
}

const privacyEvent = {
  event: 'release.request', observedAt: 1794179249443, source: 'release-static', serverId: privacyServerId,
  requestId: `${privacyServerId}-1`, connectionId: 'connection-9443', elapsedMs: 9443,
  operation: 'release-static-read', method: 'GET', status: 200, response: 'sent',
};

test('脱敏检查允许 UUID、关联编号、时间和耗时中恰好包含端口数字', /** 固定覆盖原先会随机触发的 9443 子串碰撞。 */ () => {
  verifyPrivacy([privacyEvent]);
  verifyPrivacy([{ event: 'release.listen', observedAt: 1794179249443, source: 'release-static', serverId: privacyServerId,
    keepAliveTimeoutMs: 9443, keepAliveTimeoutBufferMs: 'unavailable' }]);
});

test('脱敏检查仍拒绝端口、地址、路径、原始异常及合法字段中的敏感内容', /** 覆盖未知字段、嵌套泄露与允许字段被污染的情况。 */ () => {
  for (const leaked of [
    { remotePort: 9443 }, { remotePort: '9443' }, { remoteAddress: '127.0.0.1' }, { url: secret },
    { path: '/private' }, { message: secret }, { error: { cause: { message: secret } } },
    { serverId: secret }, { requestId: secret }, { connectionId: '9443' }, { elapsedMs: '9443' },
    { observedAt: secret }, { status: '200' }, { method: secret }, { source: secret }, { response: secret },
    { event: 'release.unknown' },
  ]) {
    assert.throws(/** 验证同一事件被敏感或非法字段污染后必定失败。 */ () => verifyPrivacy([{ ...privacyEvent, ...leaked }]),
      { code: 'ERR_ASSERTION' });
  }
});

test('连接事件模拟与请求使用同一编号，关闭原因未知不猜测且持久化不含连接值', /** 验证连接事件模拟与请求使用同一编号，关闭原因未知不猜测且持久化不含连接值。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-tcp-log-'));
  context.after(/** 发布诊断测试结束后删除临时目录。 */ () => rm(directory, { force: true, recursive: true }));
  const record = releaseDiagnosticWriter(directory);
  const socket = Object.assign(new EventEmitter(), { remoteAddress: secret, remotePort: 9443 });
  observeReleaseConnection(socket, { connectionId: 'connection-1', serverId: privacyServerId }, record);
  const response = Object.assign(new EventEmitter(), { headersSent: true, statusCode: 200, writableFinished: true });
  for (const requestId of [`${privacyServerId}-1`, `${privacyServerId}-2`]) {
    observeReleaseResponse({ method: 'GET', url: secret }, response,
      { connectionId: 'connection-1', serverId: privacyServerId, requestId }, record);
  }
  socket.emit('timeout');
  socket.emit('error', new Error(secret, { cause: new Error(secret) }));
  socket.emit('end');
  socket.emit('close', true);
  const output = await readFile(path.join(directory, 'release-server-events.jsonl'), 'utf8');
  const events = output.trim().split('\n').map(/** 将当前条目映射为`JSON.parse(line)`。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
  verifyPrivacy(events);
  assert.deepEqual(events.map(/** 将当前条目映射为`event.event`。
 * @param event - 当前触发的事件。 */ event => event.event), ['release.tcp-open', 'release.request', 'release.request',
    'release.tcp-timeout', 'release.tcp-error', 'release.tcp-end', 'release.tcp-close']);
  assert.ok(events.every(/** 确认所有条目均满足：`event.connectionId === 'connection-1'`。
 * @param event - 当前触发的事件。 */ event => event.connectionId === 'connection-1'));
  assert.ok(events.filter(/** 仅保留满足以下条件的条目：`event.event.startsWith('release.tcp')`。
 * @param event - 当前触发的事件。 */ event => event.event.startsWith('release.tcp')).every(/** 确认所有条目均满足：`!('status' in event) && !('method' in event)`。
 * @param event - 当前触发的事件。 */ event => !('status' in event) && !('method' in event)));
  assert.equal(events.at(-1).outcome, 'error');
});

test('无响应头的读取失败不能记为默认200，已发200后的中断仍保留200及未完成状态', /** 验证无响应头的读取失败不能记为默认200，已发200后的中断仍保留200及未完成状态。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-stream-log-'));
  context.after(/** 删除本轮发布响应诊断的临时资源。 */ () => rm(directory, { force: true, recursive: true }));
  const record = releaseDiagnosticWriter(directory);
  for (const sent of [false, true]) {
    const response = Object.assign(new EventEmitter(), { headersSent: sent, statusCode: 200, writableFinished: false });
    const lifecycle = observeReleaseResponse({ method: 'GET', url: secret }, response,
      { requestId: `${privacyServerId}-${sent ? 1 : 2}`, connectionId: 'connection-1', serverId: privacyServerId }, record);
    const stream = new EventEmitter();
    lifecycle.stream(stream);
    stream.emit('error', new Error(secret, { cause: new Error(secret) }));
    stream.emit('close');
    response.emit('close');
  }
  const output = await readFile(path.join(directory, 'release-server-events.jsonl'), 'utf8');
  const events = output.trim().split('\n').map(/** 将当前条目映射为`JSON.parse(line)`。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
  verifyPrivacy(events);
  assert.equal(events.length, 10);
  for (const event of events) {
    assert.equal(event.source, 'release-static');
    assert.equal(event.operation, 'release-static-read');
    assert.equal(event.method, 'GET');
    assert.equal(event.status, event.requestId === `${privacyServerId}-1` ? 200 : 'unavailable');
  }
  assert.equal(events.filter(/** 仅保留满足以下条件的条目：`event.event === 'release.interrupted'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.interrupted').length, 2);
  assert.equal(events.filter(/** 仅保留满足以下条件的条目：`event.event === 'release.stream-error'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.stream-error').length, 2);
  assert.equal(events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'release.finish'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.finish'), false);
});

test('实际静态服务成功、404和文件流失败仍保持原传输结果且可关联服务收到的请求', /** 验证实际静态服务成功、404和文件流失败仍保持原传输结果且可关联服务收到的请求。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-static-diagnostic-'));
  context.after(/** 清理发布诊断输出及临时文件。 */ () => rm(directory, { force: true, recursive: true }));
  await writeFile(path.join(directory, 'index.html'), 'isolated static fixture');
  let fail = false;
  const events = [];
  const { createReadStream } = await import('node:fs');
  const { server, baseUrl, serverId } = await startReleaseWebServer(directory, {
    record: /** 记录实际生命周期。
 * @param event - 服务端事件。
 */ event => events.push(event),
    openStream: /** 仅替换文件流读取边界。
 * @param filename - 本例静态文件。
 */ filename => fail ? new Readable({ /** 注入实际读取失败。 */ read() { this.destroy(new Error(secret)); } }) : createReadStream(filename),
  });
  context.after(/** 关闭诊断测试服务与所有活动连接。 */ () => { server.closeAllConnections(); server.close(); });
  const response = await fetch(baseUrl);
  assert.equal(await response.text(), 'isolated static fixture');
  assert.match(response.headers.get('X-Clrn-Release-Request'), new RegExp(`^${serverId}-[1-9][0-9]*$`));
  assert.equal((await fetch(new URL('missing.js', baseUrl))).status, 404);
  fail = true;
  await assert.rejects(/** 读取传输中断的发布资源正文，验证客户端仍收到失败。 */ async () => { const broken = await fetch(baseUrl); await broken.text(); });
  assert.ok(events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'release.finish' && event.status === 200`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.finish' && event.status === 200));
  assert.ok(events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'release.finish' && event.status === 404`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.finish' && event.status === 404));
  assert.ok(events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'release.stream-error'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.stream-error'));
  assert.ok(events.filter(/** 仅保留满足以下条件的条目：`event.operation === 'release-static-read'`。
 * @param event - 当前触发的事件。 */ event => event.operation === 'release-static-read').every(/** 确认所有条目均满足：`event.connectionId && event.requestId`。
 * @param event - 当前触发的事件。 */ event => event.connectionId && event.requestId));
  const configuration = events.find(/** 查找满足以下条件的首个条目：`event.event === 'release.listen'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.listen');
  assert.equal(configuration.keepAliveTimeoutMs, server.keepAliveTimeout);
  assert.equal(configuration.keepAliveTimeoutBufferMs, server.keepAliveTimeoutBuffer);
  verifyPrivacy(events);
});


test('静态服务日志使用既有上传路径，并明确记录容量截断', /** 验证静态服务日志使用既有上传路径，并明确记录容量截断。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  for (const [script, expected] of [['test:animations:ci', 'animations'], ['test:functional:existing', 'cases'],
    ['test:interactions', 'interactions'], ['test:freshchat', 'freshchat']]) {
    assert.equal(releaseDiagnosticDirectory(['npm', 'run', script]), `test-results/${expected}/release-server`);
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-log-bound-'));
  context.after(/** 清理本轮诊断测试创建的临时目录。 */ () => rm(directory, { force: true, recursive: true }));
  const persistent = path.join(directory, 'persistent');
  const record = releaseDiagnosticWriter(directory, persistent);
  await rm(directory, { recursive: true });
  // 模拟 Playwright 在启动时清理输出目录，日志必须能够继续写入。
  for (let index = 0; index < 10005; index++) record({ event: 'release.request' });
  const lines = (await readFile(path.join(directory, 'release-server-events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 10001);
  assert.equal(JSON.parse(lines.at(-1)).event, 'release.truncated');
  assert.equal(await readFile(path.join(persistent, 'release-server-events.jsonl'), 'utf8'), lines.join('\n') + '\n');
  const manifest = JSON.parse(await readFile(path.join(persistent, 'release-server-manifest.json'), 'utf8'));
  assert.equal(manifest.dropped, 5);
  assert.equal(manifest.events, 10000);
  assert.equal(manifest.truncationMarkers, 1);
  assert.ok(manifest.startedAt <= manifest.lastRetainedAt);
  assert.ok(manifest.lastRetainedAt <= manifest.lastObservedAt);
  assert.ok(manifest.droppedBytes > 0);
});
