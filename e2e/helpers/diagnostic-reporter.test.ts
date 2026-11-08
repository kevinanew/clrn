/** 使用真实 reporter 和汇总出口验证输入标题的脱敏副本，不需要应用或浏览器。 */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FullConfig, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import DiagnosticReporter from './diagnostic-reporter';
import { diagnosticCaseDirectory } from './diagnostic-log';

/**
 * 隔离 reporter 修改的进程环境，两个产物测试结束后均恢复原会话。
 * @param context - 测试清理接口。
 * @param prefix - 当前产物测试的临时目录前缀。
 */
function reporterDirectory(context: TestContext, prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  const previous = { CLRN_DIAGNOSTICS_DIR: process.env.CLRN_DIAGNOSTICS_DIR,
    CLRN_DIAGNOSTIC_SESSION: process.env.CLRN_DIAGNOSTIC_SESSION, E2E_TEST_PASSWORD: process.env.E2E_TEST_PASSWORD };
  context.after(/** 恢复报告器修改的环境并清理公开哨兵文件。 */ () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { force: true, recursive: true });
  });
  process.env.CLRN_DIAGNOSTICS_DIR = directory;
  return directory;
}

test('输入标题的内嵌引号、转义、伪定位器、换行及长 Secret 不进入步骤或汇总产物', /** 检查开始、结束及所有父步骤路径，而非仅断言脱敏函数被调用。
 * @param context - 测试清理接口。
 */ context => {
  const directory = reporterDirectory(context, 'clrn-reporter-input-');
  process.env.E2E_TEST_PASSWORD = 'public-env-prefix' + 'x'.repeat(2100) + '"public-env-tail';
  const reporter = new DiagnosticReporter();
  reporter.onBegin({} as FullConfig);
  const result = { retry: 0, workerIndex: 0, startTime: new Date(), duration: 1,
    errors: [], attachments: [], status: 'passed' } as unknown as TestResult;
  const testCase = { id: 'input-privacy', repeatEachIndex: 0, expectedStatus: 'passed',
    titlePath: /** 返回固定用例标题。 */ () => ['input privacy'],
    parent: { project: /** 使用固定项目身份。 */ () => ({ name: 'mobile', use: {} }) } } as unknown as TestCase;
  reporter.onTestBegin(testCase, result);
  const values = ['public-prefix"public-quoted-tail', 'public-escape\\"public-escape-tail',
    'public-boundary" locator(\'public-forged\')"public-boundary-tail', 'public-line\npublic-line-tail',
    process.env.E2E_TEST_PASSWORD];
  for (const action of ['Fill', 'Type', 'Insert', 'Insert text']) for (const value of values) {
    const title = `${action} "${value}" locator('[data-testid="input-target"]')`;
    const step = { title, category: 'pw:api', duration: 1,
      titlePath: /** 重复包含原始输入标题的嵌套路径。 */ () => [title, 'nested operation', title] } as unknown as TestStep;
    reporter.onStepBegin(testCase, result, step);
    reporter.onStepEnd(testCase, result, step);
  }
  const click = { title: "Click locator('action-target')", category: 'pw:api', duration: 1,
    titlePath: /** 非输入动作继续保留实际定位器。 */ () => ["Click locator('action-target')"] } as unknown as TestStep;
  reporter.onStepBegin(testCase, result, click);
  reporter.onStepEnd(testCase, result, click);
  const message = 'locator.fill: Element is not an <input>\nCall log:\n - fill("public-failed-prefix"public-failed-tail")';
  const failed = { ...click, error: { message } } as TestStep;
  result.errors = [{ message }];
  result.status = 'failed';
  reporter.onStepBegin(testCase, result, failed);
  reporter.onStepEnd(testCase, result, failed);
  reporter.onTestEnd(testCase, result);
  reporter.onEnd({ status: 'failed', startTime: new Date(), duration: 1 });
  const caseDirectory = diagnosticCaseDirectory({ testId: testCase.id, ...result, repeatEachIndex: 0 });
  const steps = readFileSync(path.join(caseDirectory, 'steps.jsonl'), 'utf8');
  assert.ok(!steps.includes('public-'), '任何输入片段均不能保留');
  assert.ok(steps.includes('action-target'), '普通点击目标不能丢失');
  const events = steps.trim().split('\n').map(/** 读取实际落盘的完整事件。
   * @param line - JSONL 单行。
   */ line => JSON.parse(line));
  for (const event of ['test.step-start', 'test.step-end']) assert.equal(events.filter(/** 确认每个动作的两个边界均被保存。
   * @param item - 持久化事件。
   */ item => item.event === event).length, 22);
  execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/ci-web-diagnostics.mjs')],
    { env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    assert.ok(!readFileSync(path.join(entry.parentPath, entry.name), 'utf8').includes('public-'), entry.name);
  }
});

test('路径及白名单 body 图片/录像和连接摘要按原字节保存，其他附件仍被排除', /** 检查真实落盘字节、关联及未被修改的源附件。
 * @param context - 测试清理接口。
 */ context => {
  const directory = reporterDirectory(context, 'clrn-reporter-attachments-');
  process.env.CLRN_DIAGNOSTICS_DIR = path.join(directory, 'diagnostics');
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  const source = path.join(directory, 'original.png');
  writeFileSync(source, image);
  const connection = Buffer.from('{"events":[{"event":"http.response","status":503}]}');
  const connectionPath = path.join(directory, 'connection-diagnostics.json');
  writeFileSync(connectionPath, connection);
  const attachments = [
    { name: 'path-screenshot', path: source, contentType: 'image/png' },
    { name: '流水校验失败页面', body: image, contentType: 'image/png' },
    { name: '截图.json', body: Buffer.from([255, 216, 255, 217]), contentType: 'image/jpeg' },
    { name: 'recording', body: Buffer.from([26, 69, 223, 163]), contentType: 'video/webm' },
    { name: 'connection-diagnostics', body: connection, contentType: 'application/json' },
    { name: 'connection-summary', body: Buffer.from('HTTP 503'), contentType: 'text/markdown' },
    { name: 'connection-diagnostics', path: connectionPath, contentType: 'application/json' },
    { name: 'trace', body: Buffer.from('forbidden trace'), contentType: 'application/zip' },
    { name: 'storage-state', body: Buffer.from('{"cookies":["forbidden credential"]}'), contentType: 'application/json' },
    { name: 'forbidden.png', body: Buffer.from('forbidden text body'), contentType: 'text/plain' },
    { name: 'screenshot', body: image, contentType: 'application/octet-stream' },
    { name: 'vector', body: Buffer.from('<svg>forbidden markup</svg>'), contentType: 'image/svg+xml' },
    { name: 'trace', path: connectionPath, contentType: 'image/png' },
  ];
  const reporter = new DiagnosticReporter();
  reporter.onBegin({} as FullConfig);
  const result = { retry: 0, workerIndex: 0, startTime: new Date(), duration: 1,
    errors: [], attachments, status: 'failed' } as unknown as TestResult;
  const testCase = { id: 'attachment-retention', repeatEachIndex: 0, expectedStatus: 'passed',
    titlePath: /** 固定用例名称用于检查附件归属。 */ () => ['attachment retention'],
    parent: { project: /** 固定视口身份，不读取真实账号数据。 */ () => ({ name: 'mobile', use: {} }) } } as unknown as TestCase;
  reporter.onTestBegin(testCase, result);
  reporter.onTestEnd(testCase, result);
  const caseDirectory = diagnosticCaseDirectory({ testId: testCase.id, ...result });
  const expected = ['attachment-0.png', 'attachment-1.png', 'attachment-2.jpg', 'attachment-3.webm',
    'attachment-4.json', 'attachment-5.md', 'attachment-6.json'];
  const retained = readdirSync(caseDirectory).filter(/** 只比较真正复制的附件，排除日志和身份清单。
   * @param file - 同例文件名。
   */ file => file.startsWith('attachment-'));
  assert.deepEqual(retained.sort(), [...expected].sort());
  for (const [index, file] of expected.entries()) {
    assert.deepEqual(readFileSync(path.join(caseDirectory, file)), attachments[index].body ?? readFileSync(attachments[index].path!));
  }
  const events = readFileSync(path.join(caseDirectory, 'steps.jsonl'), 'utf8').trim().split('\n').map(
    /** 解析持久化的附件关联，确保报告中可以找到原名称。
     * @param line - 单条事件。
     */ line => JSON.parse(line)).filter(/** 仅检查附件关联事件。
     * @param event - 日志事件。
     */ event => event.event === 'test.attachment');
  assert.deepEqual(events.map(/** 同时检查原名称与目标文件，不能静默保留无关联图片。
   * @param event - 附件关联。
   */ event => ({ name: event.name, file: event.file })), expected.map(/** 对照输入附件的顺序。
   * @param file - 目标文件名。
   * @param index - 原附件序号。
   */ (file, index) => ({ name: attachments[index].name, file })));
  assert.deepEqual(readFileSync(source), image);
  assert.deepEqual(readFileSync(connectionPath), connection);
  assert.equal(result.status, 'failed');
});
