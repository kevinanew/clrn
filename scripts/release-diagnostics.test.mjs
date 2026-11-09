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

/**
 * 所有输出只包含生命周期、逻辑操作、方法、状态及本地随机关联编号。
 * @param output - 持久化内容。
 */
function verifyPrivacy(output) {
  for (const value of ['release.invalid', '9443', '/private', 'synthetic-', '127.0.0.1']) assert.ok(!output.includes(value), value);
}

test('连接事件模拟与请求使用同一编号，关闭原因未知不猜测且持久化不含连接值', /** 验证连接事件模拟与请求使用同一编号，关闭原因未知不猜测且持久化不含连接值。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-tcp-log-'));
  context.after(/** 发布诊断测试结束后删除临时目录。 */ () => rm(directory, { force: true, recursive: true }));
  const record = releaseDiagnosticWriter(directory);
  const socket = Object.assign(new EventEmitter(), { remoteAddress: secret, remotePort: 9443 });
  observeReleaseConnection(socket, { connectionId: 'connection-1', serverId: 'server-1' }, record);
  const response = Object.assign(new EventEmitter(), { headersSent: true, statusCode: 200, writableFinished: true });
  for (const requestId of ['request-1', 'request-2']) {
    observeReleaseResponse({ method: 'GET', url: secret }, response,
      { connectionId: 'connection-1', serverId: 'server-1', requestId }, record);
  }
  socket.emit('timeout');
  socket.emit('error', new Error(secret, { cause: new Error(secret) }));
  socket.emit('end');
  socket.emit('close', true);
  const output = await readFile(path.join(directory, 'release-server-events.jsonl'), 'utf8');
  verifyPrivacy(output);
  const events = output.trim().split('\n').map(/** 将当前条目映射为`JSON.parse(line)`。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
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
      { requestId: `request-${sent}`, connectionId: 'connection-1' }, record);
    const stream = new EventEmitter();
    lifecycle.stream(stream);
    stream.emit('error', new Error(secret, { cause: new Error(secret) }));
    stream.emit('close');
    response.emit('close');
  }
  const output = await readFile(path.join(directory, 'release-server-events.jsonl'), 'utf8');
  verifyPrivacy(output);
  const events = output.trim().split('\n').map(/** 将当前条目映射为`JSON.parse(line)`。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
  assert.equal(events.length, 10);
  events.forEach(/** 核对每条真实生命周期事件的状态。
   * @param event - 已记录事件。 */ event => {
    assert.equal(event.source, 'release-static');
    assert.equal(event.operation, 'release-static-read');
    assert.equal(event.method, 'GET');
    assert.equal(event.status, event.requestId === 'request-true' ? 200 : 'unavailable');
  });
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
  verifyPrivacy(JSON.stringify(events));
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
