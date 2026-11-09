/** 无端口验证实际报告保存链路；这里的事件源只替代浏览器，不生成应用响应。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BrowserContext, Page, Request, TestInfo } from '@playwright/test';
import { installConnectionDiagnostics } from '../../visual/src/support/connectionDiagnostics';

test('请求、应用和代理的路径经过附件与失败终端输出仍保持脱敏', /** 验证请求、应用和代理的路径经过附件与失败终端输出仍保持脱敏。
 * @param t - 当前测试的生命周期与替换接口。 */ async t => {
  // 时间戳同时包含端口数字，确保脱敏断言只拒绝实际端口形式。
  t.mock.method(Date, 'now', /** 固定当前时间，使诊断文件命名和时间字段可重复断言。 */ () => 1844394430000);
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
  t.mock.method(console, 'log', /** 收集终端日志，验证持久化诊断的可定位信息。
 * @param line - 当前操作使用的 line。 */ (line: unknown) => terminal.push(line));
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
        ':8443', ':9443', 'synthetic-secret', '%2561pi']) assert.ok(!output.includes(forbidden), forbidden);
    }
    const events = JSON.parse(saved).events;
    assert.ok(events.some(/** 确认落盘诊断保留了上游实际返回的 503 状态。
 * @param event - 当前触发的事件。 */ (event: { status: number; source: string }) => event.status === 503 && event.source === 'upstream'));
    assert.ok(events.some(/** 确认落盘诊断包含未完成的 HTTP 请求。
 * @param event - 当前触发的事件。 */ (event: { event: string }) => event.event === 'http.pending'));
    assert.ok(events.some(/** 确认钱包请求按脱敏路径模板写入诊断。
 * @param event - 当前触发的事件。 */ (event: { path: string }) => event.path === '/v10/wallet/{user}'));
    assert.ok(events.some(/** 确认测试失败事件随连接诊断一起落盘。
 * @param event - 当前触发的事件。 */ (event: { event: string }) => event.event === 'test.failure'));
    assert.deepEqual(attachments, ['connection-diagnostics', 'connection-summary']);
    assert.equal(terminal.length, 1, '失败仍输出诊断摘要');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
