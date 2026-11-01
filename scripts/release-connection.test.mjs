/** 本地 Release 使用真实 HTTP 验证逐响应关闭，不依赖空闲超时或重试。 */
import assert from 'node:assert/strict';
import { Agent, request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
import { startReleaseWebServer } from './release-web-server.mjs';

/**
 * 客户端主动请求复用，完整读取响应；任何断流都使本次请求失败，不重试。
 * @param address - 仅为本例独占的回环入口。
 * @param agent - 允许复用的真实客户端连接池。
 * @param method - 本例实际方法。
 */
function read(address, agent, method) {
  return new Promise((resolve, reject) => {
    const pending = request(address, { agent, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode,
        connection: response.headers.connection, complete: response.complete,
        body: Buffer.concat(chunks) }));
    });
    pending.on('error', reject);
    pending.end();
  });
}

test('逐响应关闭静态上游，完整读取和原HTTP状态保留，不等待空闲回收', async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-release-connection-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const contents = Buffer.alloc(4 * 1024 * 1024, 65);
  await writeFile(path.join(directory, 'index.html'), contents);
  const events = [];
  const { server, baseUrl } = await startReleaseWebServer(directory, {
    record: /** 保存本例固定安全事件。
 * @param event - 生产服务的生命周期。
 */ event => events.push(event),
  });
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  context.after(() => { agent.destroy(); server.closeAllConnections(); server.close(); });
  const requests = [
    ['GET', '', 200, contents], ['GET', '', 200, contents],
    ['HEAD', '', 200, Buffer.alloc(0)], ['GET', 'missing.js', 404, Buffer.alloc(0)],
    ['POST', '', 405, Buffer.alloc(0)],
  ];
  // 收完正文即发下一次，不等服务或客户端的 socket close 回调。
  for (const [method, pathname, status, expected] of requests) {
    const response = await read(new URL(pathname, baseUrl), agent, method);
    assert.equal(response.status, status);
    assert.equal(response.connection, 'close');
    assert.equal(response.complete, true);
    assert.deepEqual(response.body, expected);
  }
  const deadline = Date.now() + 2000;
  while (events.filter(event => event.event === 'release.tcp-close').length < requests.length) {
    assert.ok(Date.now() < deadline, '响应完成后连接必须关闭');
    await setTimeout(10);
  }
  const received = events.filter(event => event.event === 'release.request');
  assert.equal(received.length, requests.length);
  assert.equal(new Set(received.map(event => event.connectionId)).size, requests.length);
  assert.equal(events.filter(event => event.event === 'release.finish').length, requests.length);
  assert.equal(events.some(event => event.event === 'release.tcp-timeout'), false);
  assert.equal(events.some(event => event.event === 'release.interrupted'), false);
});
