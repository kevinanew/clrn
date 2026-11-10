/** 使用本机 HTTP 服务和真实 Chromium 验证诊断链路；无需测试账号或外网服务。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type TestInfo } from '@playwright/test';
import { diagnosticNode } from './diagnostic-privacy';
import { installConnectionDiagnostics, recordDiagnostic } from '../../visual/src/support/connectionDiagnostics';

test('真实浏览器保留失败前的操作、节点列表、未完成请求和应用缓存事件', /** 验证真实浏览器保留失败前的操作、节点列表、未完成请求和应用缓存事件。 */ async () => {
  const server = createServer(/** 为连接诊断浏览器测试提供元数据与挂起请求的本机响应。
 * @param request - 当前发出的接口请求。
 * @param response - 当前收到的接口响应。 */ (request, response) => {
    if (request.url === '/pending') return;
    if (request.url === '/public/v12/metadata/servers') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ result: { servers: ['api.fixture.invalid'] }, token: 'secret' }));
      return;
    }
    response.end('<html><body>offline diagnostics</body></html>');
  });
  await new Promise<void>(/** 等待连接诊断测试服务开始监听。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assertAddress(address);
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-diagnostics-test-'));
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const attached: string[] = [];
    const info = { title: 'offline', project: { name: 'mobile' }, repeatEachIndex: 0, retry: 0,
      outputPath: /** 使用独立临时目录。
       * @param file - 附件文件名。
       */ (file: string) => path.join(directory, file),
      attach: /** 记录报告附件名称。
       * @param name - 附件名称。
       */ async (name: string) => { attached.push(name); } } as unknown as TestInfo;
    const diagnostics = await installConnectionDiagnostics(context, page, info);
    await page.goto(`http://127.0.0.1:${address.port}`);
    recordDiagnostic(page, '创建房间');
    await page.evaluate(/** 触发节点元数据读取和带敏感字段的诊断事件，验证采集脱敏。 */ async () => {
      await fetch('/public/v12/metadata/servers');
      window.dispatchEvent(new CustomEvent('laiwan:connection-diagnostic', { detail: {
        event: 'probe.cache', node: 'api.fixture.invalid', cacheAgeMs: 200,
        token: 'secret', body: { token: 'secret' },
      } }));
      void fetch('/pending').catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => {});
    });
    await page.waitForTimeout(100);
    await diagnostics.save(new Error('应用显示重试弹窗'));
    const saved = await readFile(path.join(directory, 'connection-diagnostics.json'), 'utf8');
    for (const value of ['api.fixture.invalid', '127.0.0.1', `:${address.port}`]) {
      assert.ok(!saved.includes(value), '连接入口不能进入保存的诊断');
    }
    assert.ok(!saved.includes('secret'));
    const result = JSON.parse(saved);
    assert.ok(result.events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'nodes.received'`。
 * @param event - 当前触发的事件。 */ (event: { event: string }) => event.event === 'nodes.received'));
    assert.ok(result.events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'http.pending'`。
 * @param event - 当前触发的事件。 */ (event: { event: string }) => event.event === 'http.pending'));
    assert.ok(result.events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'probe.cache' && event.source === 'application'`。
 * @param event - 当前触发的事件。 */ (event: { event: string; source: string }) => event.event === 'probe.cache' && event.source === 'application'));
    const node = diagnosticNode('api.fixture.invalid');
    assert.ok(result.events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'nodes.received' && event.candidates.includes(node)`。
 * @param event - 当前触发的事件。 */ (event: { event: string; candidates: string[] }) =>
      event.event === 'nodes.received' && event.candidates.includes(node)));
    assert.ok(result.events.some(/** 判断是否存在满足以下条件的条目：`event.event === 'probe.cache' && event.node === node`。
 * @param event - 当前触发的事件。 */ (event: { event: string; node: string }) =>
      event.event === 'probe.cache' && event.node === node));
    const summary = await readFile(path.join(directory, 'connection-summary.md'), 'utf8');
    assert.ok(summary.includes(node));
    assert.ok(!summary.includes('api.fixture.invalid'));
    assert.deepEqual(attached, ['connection-diagnostics', 'connection-summary']);
    await context.close();
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>(/** 等待本机连接诊断服务关闭，并传播关闭错误。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => server.close(/** 按关闭结果完成或拒绝测试服务的清理等待。
 * @param error - 当前操作抛出的错误。 */ error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 校验本机监听结果，保留端口断言。
 * @param address - 真实服务地址。
 */
function assertAddress(address: AddressInfo | string | null): asserts address is AddressInfo {
  assert.ok(address && typeof address !== 'string');
}
