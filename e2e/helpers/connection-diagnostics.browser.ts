/** 使用本机 HTTP 服务和真实 Chromium 验证诊断链路；无需测试账号或外网服务。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type TestInfo } from '@playwright/test';
import { installConnectionDiagnostics, recordDiagnostic } from '../../visual/src/support/connectionDiagnostics';

test('真实浏览器保留失败前的操作、节点列表、未完成请求和应用缓存事件', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/pending') return;
    if (request.url === '/public/v12/metadata/servers') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ result: { servers: ['64.kr-seoul.api.staging.laiwan.shafayouxi.com'] }, token: 'secret' }));
      return;
    }
    response.end('<html><body>offline diagnostics</body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
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
    await page.evaluate(async () => {
      await fetch('/public/v12/metadata/servers');
      window.dispatchEvent(new CustomEvent('laiwan:connection-diagnostic', { detail: {
        event: 'probe.cache', node: '64.kr-seoul.api.staging.laiwan.shafayouxi.com', cacheAgeMs: 200,
        token: 'secret', body: { token: 'secret' },
      } }));
      void fetch('/pending').catch(() => {});
    });
    await page.waitForTimeout(100);
    await diagnostics.save(new Error('应用显示重试弹窗'));
    const saved = await readFile(path.join(directory, 'connection-diagnostics.json'), 'utf8');
    assert.ok(!saved.includes('shafayouxi.com'));
    assert.ok(!saved.includes('secret'));
    const result = JSON.parse(saved);
    assert.ok(result.events.some((event: { event: string }) => event.event === 'nodes.received'));
    assert.ok(result.events.some((event: { event: string }) => event.event === 'http.pending'));
    assert.ok(result.events.some((event: { event: string; source: string }) => event.event === 'probe.cache' && event.source === 'application'));
    assert.deepEqual(attached, ['connection-diagnostics', 'connection-summary']);
    await context.close();
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
