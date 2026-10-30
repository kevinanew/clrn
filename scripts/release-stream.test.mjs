/** 真实文件源在正常传输、客户端取消和打开前断开时均须关闭；不使用业务接口。 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { closeSync, createReadStream, fstatSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { pipeReleaseFile, startReleaseWebServer } from './release-web-server.mjs';

/**
 * 为每例创建独占文件并清理本例的源，失败时也不遗留句柄。
 * @param context - 测试的资源清理钩子。
 */
async function fixture(context) {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-release-stream-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'index.html');
  const contents = Buffer.alloc(4 * 1024 * 1024, 65);
  await writeFile(filename, contents);
  return { directory, filename, contents };
}

/**
 * 有界等待关闭，不把等待超时或取消当成传输成功。
 * @param stream - 应当最终释放的流。
 */
async function closed(stream) {
  if (stream.closed) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('文件源未在预算内关闭')), 2000);
    stream.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

test('完整读取的字节一致，源结束并关闭真实文件描述符', async context => {
  const { filename, contents } = await fixture(context);
  const source = createReadStream(filename);
  context.after(() => source.destroy());
  const response = new PassThrough();
  const chunks = [];
  let descriptor;
  source.once('open', fd => { descriptor = fd; });
  response.on('data', chunk => chunks.push(chunk));
  const released = closed(source);
  const finished = once(response, 'finish');
  pipeReleaseFile(source, response);
  await Promise.all([released, finished]);
  assert.deepEqual(Buffer.concat(chunks), contents);
  assert.equal(source.readableEnded, true);
  assert.equal(source.closed, true);
  assert.throws(() => fstatSync(descriptor), { code: 'EBADF' });
});

test('首块后客户端取消，源未结束但必须关闭真实文件描述符', async context => {
  const { filename, contents } = await fixture(context);
  for (let index = 0; index < 20; index++) {
    const source = createReadStream(filename);
    context.after(() => source.destroy());
    const response = new PassThrough();
    let descriptor;
    let bytes = 0;
    source.once('open', fd => { descriptor = fd; });
    response.once('data', chunk => { bytes += chunk.length; response.destroy(); });
    const released = closed(source);
    pipeReleaseFile(source, response);
    await released;
    assert.ok(bytes > 0 && bytes < contents.length);
    assert.equal(response.writableFinished, false);
    assert.equal(source.readableEnded, false);
    assert.equal(source.closed, true);
    assert.throws(() => fstatSync(descriptor), { code: 'EBADF' });
  }
});

test('源尚未打开时取消，以及绑定前响应已经关闭，源均最终关闭', async context => {
  const { filename } = await fixture(context);
  for (const alreadyClosed of [false, true]) {
    const source = createReadStream(filename);
    context.after(() => source.destroy());
    const response = new PassThrough();
    assert.equal(source.pending, true);
    if (alreadyClosed) {
      const stopped = closed(response);
      response.destroy();
      await stopped;
    }
    const released = closed(source);
    pipeReleaseFile(source, response);
    if (!alreadyClosed) response.destroy();
    await released;
    assert.equal(source.closed, true);
    assert.equal(source.fd, null);
    assert.equal(source.readableEnded, false);
    assert.equal(response.writableFinished, false);
  }
});

test('真实文件打开错误仍中断响应，不完成成功传输且不泄露底层错误', async context => {
  const { directory } = await fixture(context);
  const source = createReadStream(path.join(directory, 'synthetic-secret.invalid'));
  const response = new PassThrough();
  const errors = [];
  source.on('error', error => errors.push(error.code));
  // 生产诊断也只监听事件，不把 error 对象传入持久化出口。
  response.on('error', () => {});
  const released = closed(source);
  pipeReleaseFile(source, response);
  await released;
  assert.deepEqual(errors, ['ENOENT']);
  assert.equal(response.destroyed, true);
  assert.equal(response.writableFinished, false);
  assert.equal(source.closed, true);
});

test('传输中真实文件描述符失效仍中断响应并关闭源，不能当成完整读取', async context => {
  const { filename, contents } = await fixture(context);
  const source = createReadStream(filename);
  const response = new PassThrough();
  const errors = [];
  let bytes = 0;
  source.on('error', error => errors.push(error.code));
  response.on('data', chunk => { bytes += chunk.length; });
  source.once('data', () => closeSync(source.fd));
  const released = closed(source);
  pipeReleaseFile(source, response);
  await released;
  assert.ok(errors.includes('EBADF'));
  assert.ok(bytes > 0 && bytes < contents.length);
  assert.equal(response.destroyed, true);
  assert.equal(response.writableFinished, false);
  assert.equal(source.readableEnded, false);
  assert.equal(source.closed, true);
});

test('生产 HTTP 服务的完整读取与首块取消均释放源，取消保留 interrupted', async context => {
  const { directory, contents } = await fixture(context);
  const sources = [];
  const events = [];
  const { server, baseUrl } = await startReleaseWebServer(directory, {
    record: /** 保存固定模板事件。
 * @param event - 生命周期记录。
 */ event => events.push(event),
    openStream: /** 使用生产原生读取源，仅观察资源释放。
 * @param filename - 本例文件。
 */ filename => {
      const source = createReadStream(filename);
      sources.push(source);
      return source;
    },
  });
  context.after(() => {
    for (const source of sources) source.destroy();
    server.closeAllConnections(); server.close();
  });
  assert.deepEqual(Buffer.from(await (await fetch(baseUrl)).arrayBuffer()), contents);
  for (let index = 0; index < 20; index++) {
    const response = await fetch(baseUrl);
    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false);
    await reader.cancel();
  }
  for (const source of sources) if (!source.closed) await closed(source);
  assert.equal(sources.length, 21);
  assert.ok(sources.every(source => source.closed && source.fd === null));
  assert.equal(events.filter(event => event.event === 'release.finish').length, 1);
  assert.equal(events.filter(event => event.event === 'release.interrupted').length, 20);
  assert.equal(events.filter(event => event.event === 'release.stream-close').length, 21);
  assert.equal(events.filter(event => event.event === 'release.stream-error').length, 0);
});
