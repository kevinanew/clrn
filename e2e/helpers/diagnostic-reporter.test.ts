/** 使用真实 reporter 和汇总出口验证输入标题的脱敏副本，不需要应用或浏览器。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FullConfig, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import DiagnosticReporter from './diagnostic-reporter';
import { diagnosticCaseDirectory } from './diagnostic-log';

test('输入标题的内嵌引号、转义、伪定位器、换行及长 Secret 不进入步骤或汇总产物', /** 检查开始、结束及所有父步骤路径，而非仅断言脱敏函数被调用。
 * @param context - 测试清理接口。
 */ context => {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-reporter-input-'));
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
