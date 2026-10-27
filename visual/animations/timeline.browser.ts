/** 用真实 Playwright 子进程确认收集全部差异后仍返回失败，且不写入正式基准。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
  return suites.flatMap(suite => [
    ...(suite.specs || []).flatMap(specification => specification.tests.flatMap(entry =>
      entry.results.map(result => ({ title: specification.title, result })))),
    ...collectResults(suite.suites || []),
  ]);
}

test('完整记录普通、局部比较和数字遮罩的差异，保留失败退出码与硬断言', async () => {
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
    assert.equal(baseline.status, 0, baseline.error?.message || baseline.stdout + baseline.stderr);
    for (const mode of ['ordinary', 'foreground', 'background', 'numeric']) {
      await rm(path.join(snapshotsDirectory, `en-offline-${mode}-first-0ms.png`));
    }
    const before = new Map(await Promise.all((await readdir(snapshotsDirectory)).map(async filename =>
      [filename, await readFile(path.join(snapshotsDirectory, filename))] as const)));
    const comparison = run(true);
    assert.equal(comparison.status, 1, comparison.error?.message || comparison.stdout + comparison.stderr);
    const report: { suites: ReportSuite[] } = JSON.parse(await readFile(reportPath, 'utf8'));
    const results = collectResults(report.suites);
    assert.equal(results.length, 6);
    for (const { title, result } of results) {
      assert.equal(result.status, 'failed', title);
      if (!title.startsWith('截图差异')) {
        assert.ok(!result.attachments.some(attachment => attachment.name.endsWith('之后')),
          `${title}不得执行错误后的步骤`);
        continue;
      }
      assert.equal(result.errors.length, 4, `${title}必须报告两个阶段各两帧的全部差异`);
      assert.ok(result.attachments.some(attachment => attachment.name === '全部阶段已完成'), title);
      const timelines = result.attachments.filter(attachment => attachment.name.endsWith('-timeline'));
      assert.equal(timelines.length, 2, title);
      for (const attachment of timelines) {
        const contents = attachment.path ? await readFile(attachment.path, 'utf8')
          : Buffer.from(attachment.body!, 'base64').toString();
        const timeline: { samples: { milliseconds: number }[] } = JSON.parse(contents);
        assert.deepEqual(timeline.samples.map(sample => sample.milliseconds), [0, 80]);
      }
      assert.ok(result.attachments.some(attachment => attachment.name.includes('-diff')), `${title}应保留差异图`);
    }
    assert.deepEqual((await readdir(snapshotsDirectory)).sort(), [...before.keys()].sort(), '比较不得创建缺失基准');
    for (const [filename, contents] of before) {
      assert.deepEqual(await readFile(path.join(snapshotsDirectory, filename)), contents, '比较不得修改旧基准');
    }
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});
