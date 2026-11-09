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
  context.after(/** 文件流测试结束后删除临时资源目录。 */ () => rm(directory, { recursive: true, force: true }));
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
  await new Promise(/** 等待文件源在预算内关闭，超时则拒绝测试。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
    const timer = setTimeout(/** 文件源未及时关闭时报告清理超时。 */ () => reject(new Error('文件源未在预算内关闭')), 2000);
    stream.once('close', /** 文件源关闭后取消超时器并完成等待。 */ () => { clearTimeout(timer); resolve(); });
  });
}

test('完整读取的字节一致，源结束并关闭真实文件描述符', /** 验证完整读取的字节一致，源结束并关闭真实文件描述符。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const { filename, contents } = await fixture(context);
  const source = createReadStream(filename);
  context.after(/** 测试结束后销毁当前文件读取流。 */ () => source.destroy());
  const response = new PassThrough();
  const chunks = [];
  let descriptor;
  source.once('open', /** 记录已打开的文件描述符，核验流关闭后的资源释放。
 * @param fd - 当前操作使用的 fd。 */ fd => { descriptor = fd; });
  response.on('data', /** 收集响应数据块，核验完整传输的正文。
 * @param chunk - 本次读取的数据块。 */ chunk => chunks.push(chunk));
  const released = closed(source);
  const finished = once(response, 'finish');
  pipeReleaseFile(source, response);
  await Promise.all([released, finished]);
  assert.deepEqual(Buffer.concat(chunks), contents);
  assert.equal(source.readableEnded, true);
  assert.equal(source.closed, true);
  assert.throws(/** 检查已完成传输的文件描述符，验证文件源已经关闭。 */ () => fstatSync(descriptor), { code: 'EBADF' });
});

test('首块后客户端取消，源未结束但必须关闭真实文件描述符', /** 验证首块后客户端取消，源未结束但必须关闭真实文件描述符。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const { filename, contents } = await fixture(context);
  for (let index = 0; index < 20; index++) {
    const source = createReadStream(filename);
    context.after(/** 用例结束后销毁中断场景中的文件源。 */ () => source.destroy());
    const response = new PassThrough();
    let descriptor;
    let bytes = 0;
    source.once('open', /** 保存文件描述符，供中断后的关闭断言使用。
 * @param fd - 当前操作使用的 fd。 */ fd => { descriptor = fd; });
    response.once('data', /** 记录首个数据块的字节数并主动中断客户端连接。
 * @param chunk - 本次读取的数据块。 */ chunk => { bytes += chunk.length; response.destroy(); });
    const released = closed(source);
    pipeReleaseFile(source, response);
    await released;
    assert.ok(bytes > 0 && bytes < contents.length);
    assert.equal(response.writableFinished, false);
    assert.equal(source.readableEnded, false);
    assert.equal(source.closed, true);
    assert.throws(/** 检查客户端中断后的文件描述符，验证文件源已经释放。 */ () => fstatSync(descriptor), { code: 'EBADF' });
  }
});

test('源尚未打开时取消，以及绑定前响应已经关闭，源均最终关闭', /** 验证源尚未打开时取消，以及绑定前响应已经关闭，源均最终关闭。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const { filename } = await fixture(context);
  for (const alreadyClosed of [false, true]) {
    const source = createReadStream(filename);
    context.after(/** 清理提前关闭场景中的文件读取流。 */ () => source.destroy());
    const response = new PassThrough();
    assert.equal(source.pending, true);
    if (alreadyClosed) {
      const stopped = closed(response);
      response.destroy();
      await stopped;
    }
    const released = closed(source);
    pipeReleaseFile(source, response);
    cancelActiveResponse(response, alreadyClosed);
    await released;
    assert.equal(source.closed, true);
    assert.equal(source.fd, null);
    assert.equal(source.readableEnded, false);
    assert.equal(response.writableFinished, false);
  }
});

test('真实文件打开错误仍中断响应，不完成成功传输且不泄露底层错误', /** 验证真实文件打开错误仍中断响应，不完成成功传输且不泄露底层错误。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const { directory } = await fixture(context);
  const source = createReadStream(path.join(directory, 'synthetic-secret.invalid'));
  const response = new PassThrough();
  const errors = [];
  source.on('error', /** 收集文件源错误码，核验异常类型。
 * @param error - 当前操作抛出的错误。 */ error => errors.push(error.code));
  // 生产诊断也只监听事件，不把 error 对象传入持久化出口。
  response.on('error', /** 吸收本用例预期的响应错误，由后续断言检查文件源行为。 */ () => {});
  const released = closed(source);
  pipeReleaseFile(source, response);
  await released;
  assert.deepEqual(errors, ['ENOENT']);
  assert.equal(response.destroyed, true);
  assert.equal(response.writableFinished, false);
  assert.equal(source.closed, true);
});

test('传输中真实文件描述符失效仍中断响应并关闭源，不能当成完整读取', /** 验证传输中真实文件描述符失效仍中断响应并关闭源，不能当成完整读取。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const { filename, contents } = await fixture(context);
  const source = createReadStream(filename);
  const response = new PassThrough();
  const errors = [];
  let bytes = 0;
  source.on('error', /** 记录文件读取错误码，验证描述符失效的传播。
 * @param error - 当前操作抛出的错误。 */ error => errors.push(error.code));
  response.on('data', /** 累计响应接收字节数，区分部分传输与完整响应。
 * @param chunk - 本次读取的数据块。 */ chunk => { bytes += chunk.length; });
  source.once('data', /** 文件打开后立即关闭描述符，制造可控的文件读取失败。 */ () => closeSync(source.fd));
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

test('生产 HTTP 服务的完整读取与首块取消均释放源，取消保留 interrupted', /** 验证生产 HTTP 服务的完整读取与首块取消均释放源，取消保留 interrupted。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
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
  context.after(/** 销毁所有文件源并关闭服务器及活动连接。 */ () => {
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
  await Promise.all(sources.map(/** 等待所有尚未关闭的真实文件源。
   * @param source - 当前文件源。 */ source => source.closed ? undefined : closed(source)));
  assert.equal(sources.length, 21);
  assert.ok(sources.every(/** 确认所有条目均满足：`source.closed && source.fd === null`。
 * @param source - 当前操作使用的 source。 */ source => source.closed && source.fd === null));
  assert.equal(events.filter(/** 仅保留满足以下条件的条目：`event.event === 'release.finish'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.finish').length, 1);
  assert.equal(events.filter(/** 仅保留满足以下条件的条目：`event.event === 'release.interrupted'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.interrupted').length, 20);
  assert.equal(events.filter(/** 仅保留满足以下条件的条目：`event.event === 'release.stream-close'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.stream-close').length, 21);
  assert.equal(events.filter(/** 仅保留满足以下条件的条目：`event.event === 'release.stream-error'`。
 * @param event - 当前触发的事件。 */ event => event.event === 'release.stream-error').length, 0);
});

/** 保持绑定后的客户端取消时序。
 * @param response - 响应流。
 * @param alreadyClosed - 绑定前是否已关闭。 */
function cancelActiveResponse(response, alreadyClosed) { if (!alreadyClosed) response.destroy(); }
