/** 无端口验证实际报告保存链路；这里的事件源只替代浏览器，不生成应用响应。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BrowserContext, Page, Request, TestInfo } from '@playwright/test';
import { installConnectionDiagnostics } from '../../visual/src/support/connectionDiagnostics';

test('请求、应用和代理的路径经过附件与失败终端输出仍保持脱敏', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-diagnostic-privacy-'));
  const page = new EventEmitter();
  let binding: ((_source: unknown, fields: unknown) => void) | undefined;
  const context = {
    /** 保留实际采集器安装的应用事件入口。
     * @param _name - 绑定名称。
     * @param callback - 采集回调。
     */
    async exposeBinding(_name: string, callback: NonNullable<typeof binding>) { binding = callback; },
    /** 本测试不执行页面脚本。 */
    async addInitScript() {},
  } as unknown as BrowserContext;
  const attachments: string[] = [];
  const info = { title: 'privacy', project: { name: 'offline' }, repeatEachIndex: 0, retry: 0,
    /** 保存到测试独占目录。
     * @param name - 产物名。
     */
    outputPath: (name: string) => path.join(directory, name),
    /** 记录实际创建的附件。
     * @param name - 附件名。
     */
    async attach(name: string) { attachments.push(name); },
  } as unknown as TestInfo;
  const terminal: unknown[] = [];
  t.mock.method(console, 'log', (line: unknown) => terminal.push(line));
  try {
    const diagnostics = await installConnectionDiagnostics(context, page as unknown as Page, info, {
      /** 模拟跨语言控制端返回的未清理历史，验证合并仍执行边界清理。 */
      async diagnostics() {
        return { dropped: 0, events: [{ event: 'proxy.response', method: 'POST', status: 503,
          path: '/nested/[2001:db8::10]:9443/token=synthetic-secret', source: 'upstream' }] };
      },
    });
    const request = {
      /** 保留地址和合成凭据，用于验证真实请求事件的边界。 */
      url: () => 'https://api.fixture.invalid/nested/192.0.2.10:8443/token=synthetic-secret',
      /** 选择实际采集的请求资源类型。 */
      resourceType: () => 'fetch',
      /** 保留请求方法。 */
      method: () => 'POST',
    } as unknown as Request;
    page.emit('request', request);
    assert.ok(binding, '安装过程必须注册应用诊断入口');
    binding({}, { event: 'probe.cache', path: '/v10/wallet/%2561pi.fixture.invalid',
      body: { nested: { path: '/synthetic-secret' } } });
    await diagnostics.save(new Error('业务读取失败'));
    const saved = await readFile(path.join(directory, 'connection-diagnostics.json'), 'utf8');
    const summary = await readFile(path.join(directory, 'connection-summary.md'), 'utf8');
    for (const output of [saved, summary, JSON.stringify(terminal)]) {
      for (const forbidden of ['api.fixture.invalid', '192.0.2.10', '2001:db8::10',
        '8443', '9443', 'synthetic-secret', '%2561pi']) assert.ok(!output.includes(forbidden));
    }
    const events = JSON.parse(saved).events;
    assert.ok(events.some((event: { status: number; source: string }) => event.status === 503 && event.source === 'upstream'));
    assert.ok(events.some((event: { event: string }) => event.event === 'http.pending'));
    assert.ok(events.some((event: { path: string }) => event.path === '/v10/wallet/{user}'));
    assert.ok(events.some((event: { event: string }) => event.event === 'test.failure'));
    assert.deepEqual(attachments, ['connection-diagnostics', 'connection-summary']);
    assert.equal(terminal.length, 1, '失败仍输出诊断摘要');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
