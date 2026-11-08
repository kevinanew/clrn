/** 验证未开始测试和收尾中断时的下载包，不依赖浏览器或真实服务。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { summarizeWebDiagnostics } from './ci-web-diagnostics.mjs';

test('采集目录缺失仍生成附件说明，不能把缺日志报告成没有错误', /** 检查缺失来源的明确说明及可下载清单。
 * @param context - 测试清理接口。
 */ async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'clrn-summary-missing-'));
  context.after(/** 删除本轮摘要测试目录。 */ () => rm(root, { force: true, recursive: true }));
  const directory = path.join(root, 'missing');
  const result = await summarizeWebDiagnostics(directory, null);
  assert.equal(result.cases, 0);
  const summary = await readFile(path.join(directory, 'README.md'), 'utf8');
  assert.ok(summary.includes('未取得用例记录'));
  assert.ok(summary.includes('不表示没有错误'));
  assert.ok(summary.includes('Artifacts'));
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sources.backend, '不可获取');
  assert.equal(manifest.sources.browser.files, 0);
  assert.match(manifest.sources.proxy.availability, /未取得文件/);
  assert.deepEqual(manifest.generatedFiles, ['README.md', 'manifest.json']);
});

test('中断的时间线保留早期事件及 running，显示准备错误并列出截图', /** 检查异常退出留下的部分文件也能汇总。
 * @param context - 测试清理接口。
 */ async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-summary-interrupted-'));
  context.after(/** 删除中断摘要测试目录。 */ () => rm(directory, { force: true, recursive: true }));
  const caseDirectory = path.join(directory, 'session', 'case');
  await mkdir(caseDirectory, { recursive: true });
  await writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ title: 'controlled interrupted case',
    project: 'mobile', status: 'running', retry: 0, repeat: 0 }));
  await writeFile(path.join(caseDirectory, 'browser.jsonl'), '{"event":"page.console","text":"early output","observedAt":2}\n{"event":');
  await writeFile(path.join(caseDirectory, 'steps.jsonl'), '{"event":"test.step-start","target":"button","observedAt":1}\n');
  await writeFile(path.join(caseDirectory, 'attachment-0.png'), 'public screenshot placeholder');
  await writeFile(path.join(directory, 'session', 'runner.jsonl'), '{"event":"run.error","text":"controlled setup failure","observedAt":0}\n');
  await writeFile(path.join(directory, 'release-server-events.jsonl'), '{"event":"release.command-end","code":17,"observedAt":3}\n');
  await summarizeWebDiagnostics(directory, null);
  const timeline = (await readFile(path.join(caseDirectory, 'timeline.jsonl'), 'utf8')).trim().split('\n').map(/** 读取汇总后的安全事件。
   * @param line - JSONL 单行。
   */ line => JSON.parse(line));
  assert.equal(timeline[0].event, 'collection.incomplete-line');
  assert.equal(timeline[1].target, 'button');
  assert.equal(timeline[2].text, 'early output');
  const summary = await readFile(path.join(directory, 'README.md'), 'utf8');
  for (const text of ['running', 'controlled setup failure', 'attachment-0.png', 'release.command-end', '17']) assert.ok(summary.includes(text), text);
});

test('收到 HTTP 错误和浏览器错误输出时，即使用例成功也在摘要中保留可观察原因', /** 不把收到错误响应或控制台错误简化为成功用例没有错误。
 * @param context - 测试清理接口。
 */ async context => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-summary-http-'));
  context.after(/** 删除已脱敏的摘要测试文件。 */ () => rm(directory, { force: true, recursive: true }));
  await writeFile(path.join(directory, 'case.json'), JSON.stringify({ title: 'HTTP diagnostic',
    project: 'mobile', status: 'passed', repeat: 0, retry: 0 }));
  await writeFile(path.join(directory, 'browser.jsonl'), [
    { event: 'http.response', status: 503, response: 'received', observedAt: 1 },
    { event: 'page.console', level: 'error', text: 'controlled-console-error', observedAt: 2 },
  ].map(/** 生成采集器会输出的安全事件行。
   * @param event - 受控失败事件。
   */ event => JSON.stringify(event)).join('\n') + '\n');
  await summarizeWebDiagnostics(directory, null);
  const summary = await readFile(path.join(directory, 'README.md'), 'utf8');
  for (const text of ['passed', '503', 'http.response', 'controlled-console-error']) assert.ok(summary.includes(text), text);
});
