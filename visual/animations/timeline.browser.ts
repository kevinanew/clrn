/** 用真实 Playwright 子进程确认收集全部差异后仍返回失败，且不写入正式基准。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertProcessStatus, snapshotContents, assertSnapshotsUnchanged, attachmentContents } from './timelineBrowserSupport';

const directory = __dirname;
const moduleRequire = createRequire(path.join(directory, 'timeline.browser.ts'));
const playwrightCommand = path.join(path.dirname(moduleRequire.resolve('@playwright/test/package.json')), 'cli.js');

type ReportResult = {
  status: string;
  errors: { message?: string }[];
  attachments: { name: string; path?: string; body?: string }[];
};
type ReportSuite = { suites?: ReportSuite[]; specs?: { title: string; tests: { results: ReportResult[] }[] }[] };

/**
 * 展开 Playwright 报告中的文件与用例分组。
 * @param suites - 本次子进程生成的报告分组。
 */
function collectResults(suites: ReportSuite[]): { title: string; result: ReportResult }[] {
  return suites.flatMap(/** 递归展开测试报告中的各次运行结果，保留案例标题。
 * @param suite - 当前操作使用的 suite。 */ suite => [
    ...(suite.specs || []).flatMap(/** 展开当前条目对应的`specification.tests.flatMap(entry => entry.results.map(result => ({ title: specification.title, result })))`。
 * @param specification - 当前操作使用的 specification。 */ specification => specification.tests.flatMap(/** 展开当前条目对应的`entry.results.map(result => ({ title: specification.title, result }))`。
 * @param entry - 当前处理的记录条目。 */ entry =>
      entry.results.map(/** 将当前条目映射为`{ title: specification.title, result }`。
 * @param result - 当前操作使用的 result。 */ result => ({ title: specification.title, result })))),
    ...collectResults(suite.suites || []),
  ]);
}

/**
 * 验证单个真实子用例的预期失败、后续步骤及差异附件，不改变被测断言。
 * @param title - 子用例标题。
 * @param result - Playwright 返回的实际结果。
 */
async function assertCaptureResult(title: string, result: ReportResult) {
  if (title.startsWith('局部稳定性有效面积：')) return assertPartialStability(title, result);
  if (title.startsWith('相邻截图稳定性：tolerated/')) {
    assert.equal(result.status, 'passed', '阈值内的相邻截图微差不得阻止后续采样');
    assert.ok(result.attachments.some(/** 判断是否存在满足以下条件的条目：`attachment.name === '稳定性检查之后'`。
 * @param attachment - 当前操作使用的 attachment。 */ attachment => attachment.name === '稳定性检查之后'));
    return;
  }
  await assertFailedCapture(title, result);
}

/**
 * 局部稳定性按五十／五十一个有效差异像素保留边界断言。
 * @param title - 子用例标题。
 * @param result - 实际运行结果。
 */
function assertPartialStability(title: string, result: ReportResult) {
  const unstable = title.includes('over-boundary/');
  assert.equal(result.status, unstable ? 'failed' : 'passed', title);
  assert.equal(result.attachments.some(/** 判断是否存在满足以下条件的条目：`attachment.name === '局部稳定性检查之后'`。
 * @param attachment - 当前操作使用的 attachment。 */ attachment => attachment.name === '局部稳定性检查之后'), !unstable, title);
  if (unstable) assert.ok(result.errors.some(/** 判断是否存在满足以下条件的条目：`error.message?.includes('首帧画面应稳定')`。
 * @param error - 当前操作抛出的错误。 */ error => error.message?.includes('首帧画面应稳定')),
    '五十一个有效差异像素必须在稳定性检查时失败，不能依赖后续基准比较');
}

/**
 * 硬错误不得继续；截图软失败仍须报告全部阶段和差异。
 * @param title - 子用例标题。
 * @param result - 实际运行结果。
 */
async function assertFailedCapture(title: string, result: ReportResult) {
  assert.equal(result.status, 'failed', title);
  if (!title.startsWith('截图差异')) {
    assert.ok(!result.attachments.some(/** 判断是否存在满足以下条件的条目：`attachment.name.endsWith('之后')`。
 * @param attachment - 当前操作使用的 attachment。 */ attachment => attachment.name.endsWith('之后')),
      `${title}不得执行错误后的步骤`);
    return;
  }
  assert.equal(result.errors.length, 4, `${title}必须报告两个阶段各两帧的全部差异`);
  assert.ok(result.attachments.some(/** 判断是否存在满足以下条件的条目：`attachment.name === '全部阶段已完成'`。
 * @param attachment - 当前操作使用的 attachment。 */ attachment => attachment.name === '全部阶段已完成'), title);
  const timelines = result.attachments.filter(/** 仅保留满足以下条件的条目：`attachment.name.endsWith('-timeline')`。
 * @param attachment - 当前操作使用的 attachment。 */ attachment => attachment.name.endsWith('-timeline'));
  assert.equal(timelines.length, 2, title);
  for (const attachment of timelines) {
    const contents = await attachmentContents(attachment);
    const timeline: { samples: { milliseconds: number }[] } = JSON.parse(contents);
    assert.deepEqual(timeline.samples.map(/** 将当前条目映射为`sample.milliseconds`。
 * @param sample - 当前操作使用的 sample。 */ sample => sample.milliseconds), [0, 80]);
  }
  assert.ok(result.attachments.some(/** 判断是否存在满足以下条件的条目：`attachment.name.includes('-diff')`。
 * @param attachment - 当前操作使用的 attachment。 */ attachment => attachment.name.includes('-diff')), `${title}应保留差异图`);
}

test('完整记录普通、局部比较和数字遮罩的差异，保留失败退出码与硬断言', /** 验证完整记录普通、局部比较和数字遮罩的差异，保留失败退出码与硬断言。 */ async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'clrn-animation-capture-'));
  try {
    const snapshotsDirectory = path.join(temporaryDirectory, 'snapshots');
    const reportPath = path.join(temporaryDirectory, 'report.json');
    const configurationPath = path.join(temporaryDirectory, 'playwright.config.mjs');
    await writeFile(configurationPath, `export default ${JSON.stringify({
      testDir: directory, testMatch: 'timelineRegression.ts',
      outputDir: path.join(temporaryDirectory, 'results'),
      snapshotPathTemplate: `${snapshotsDirectory}/{arg}{ext}`,
      updateSnapshots: 'none', workers: 1, retries: 0, timeout: 30_000,
      reporter: [['json', { outputFile: reportPath }]],
      projects: [{ name: 'offline' }],
      use: { viewport: { width: 200, height: 120 }, deviceScaleFactor: 1 },
    })};`);
    /**
     * 使用相同临时配置分别生成夹具基准和执行预期失败的比较。
     * @param compare - 是否注入与基准不同的画面及业务错误。
     */
    const run = (compare: boolean) => spawnSync(process.execPath,
      [playwrightCommand, 'test', '--config', configurationPath, ...(compare ? [] : ['--update-snapshots'])],
      { cwd: directory, encoding: 'utf8', timeout: 120_000,
        env: { ...process.env, ANIMATION_CAPTURE_COMPARISON: String(compare) } });
    const baseline = run(false);
    assertProcessStatus(baseline, 0);
    await removeFirstFrames(snapshotsDirectory);
    const before = await snapshotContents(snapshotsDirectory);
    const comparison = run(true);
    assertProcessStatus(comparison, 1);
    const report: { suites: ReportSuite[] } = JSON.parse(await readFile(reportPath, 'utf8'));
    const results = collectResults(report.suites);
    assert.equal(results.length, 25);
    await assertCaptureResults(results);
    await assertSnapshotsUnchanged(snapshotsDirectory, before);
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

/**
 * 删除每种模式的首帧，确认缺图仍软失败并采集后续帧。
 * @param directory - 临时基准目录。
 */
async function removeFirstFrames(directory: string) {
  for (const mode of ['ordinary', 'foreground', 'background', 'numeric']) {
    await rm(path.join(directory, `en-offline-${mode}-first-0ms.png`));
  }
}

/**
 * 核对每个子用例的断言与后续执行状态。
 * @param results - 原 Playwright 报告结果。
 */
async function assertCaptureResults(results: ReturnType<typeof collectResults>) {
  for (const { title, result } of results) await assertCaptureResult(title, result);
}
