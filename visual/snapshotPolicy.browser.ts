/** 用真实截图断言验证只读比较、显式更新及失败边界；不访问应用或改写正式基准。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import visualConfig from './playwright.config';
import { VISUAL_SNAPSHOT_UPDATES, type VisualRunAction } from './run-visual-config';

const moduleRequire = createRequire(import.meta.url);
const playwrightPackage = moduleRequire.resolve('@playwright/test');
const playwrightCommand = path.join(path.dirname(moduleRequire.resolve('@playwright/test/package.json')), 'cli.js');

type ReportSuite = { suites?: ReportSuite[]; specs?: { tests: { results: { status: string; retry: number }[] }[] }[] };

/**
 * 展开报告以检查失败只有一次执行，不能靠自动重试通过。
 * @param suites - Playwright 的文件与分组结果。
 */
function results(suites: ReportSuite[]): { status: string; retry: number }[] {
  return suites.flatMap(/** 展开当前条目对应的`[ ...(suite.specs || []).flatMap(spec => spec.tests.flatMap(entry => entry.results)), ...results(suite.suites || []), ]`。
 * @param suite - 当前操作使用的 suite。 */ suite => [
    ...(suite.specs || []).flatMap(/** 展开当前条目对应的`spec.tests.flatMap(entry => entry.results)`。
 * @param spec - 当前操作使用的 spec。 */ spec => spec.tests.flatMap(/** 展开当前条目对应的`entry.results`。
 * @param entry - 当前处理的记录条目。 */ entry => entry.results)),
    ...results(suite.suites || []),
  ]);
}

/**
 * 保留启动错误优先于进程输出的诊断顺序。
 * @param child - 当前浏览器进程结果。
 */
function childDiagnostic(child: ReturnType<typeof spawnSync>): string {
  if (child.error?.message) return child.error.message;
  return String(child.stdout) + String(child.stderr);
}

test('普通比较不写基准；显式采集也更新容差内变化；真实缺陷、尺寸和业务错误仍失败且零重试', /** 验证普通比较不写基准；显式采集也更新容差内变化；真实缺陷、尺寸和业务错误仍失败且零重试。 */ async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-snapshot-policy-'));
  try {
    const config = path.join(directory, 'playwright.config.mjs');
    const snapshot = path.join(directory, 'snapshots', 'current.png');
    const report = path.join(directory, 'report.json');
    await writeFile(config, `export default ${JSON.stringify({
      ...visualConfig, testDir: directory, testMatch: 'policy.spec.mjs', testIgnore: [],
      outputDir: path.join(directory, 'results'), snapshotPathTemplate: `${directory}/snapshots/{arg}{ext}`,
      reporter: [['json', { outputFile: report }]],
      use: { ...visualConfig.use, viewport: { width: 200, height: 120 } },
    })};`);
    await writeFile(path.join(directory, 'policy.spec.mjs'), `
import playwright from ${JSON.stringify(playwrightPackage)};
const { test, expect } = playwright;
test('current page', async ({ page }) => {
  const kind = process.env.SNAPSHOT_POLICY_CASE;
  if (kind === 'size') await page.setViewportSize({ width: 201, height: 120 });
  await page.setContent('<html style="background:white"><body style="margin:0">'
    + '<div style="background:black;width:' + (kind === 'defect' ? 20 : kind === 'slight' ? 1 : 0)
    + 'px;height:20px"></div></body></html>');
  expect(kind, '业务状态错误不能通过更新图片接受').not.toBe('business');
  await expect(page).toHaveScreenshot('current.png');
});
`);
    /**
     * 沿用生产配置及运行器的更新参数，在临时基准上执行真实浏览器比较。
     * @param action - 普通比较或显式采集。
     * @param kind - 要展示的画面或硬断言负例。
     */
    const run = async (action: VisualRunAction, kind: string) => {
      const child = spawnSync(process.execPath, [playwrightCommand, 'test', '--config', config,
        ...(action === 'reference' ? [`--update-snapshots=${VISUAL_SNAPSHOT_UPDATES[action]}`] : [])], {
        cwd: directory, encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, SNAPSHOT_POLICY_CASE: kind },
      });
      const detail = childDiagnostic(child);
      const parsed: { suites: ReportSuite[] } = JSON.parse(await readFile(report, 'utf8'));
      const actual = results(parsed.suites);
      assert.equal(actual.length, 1, `每次运行只执行一次：${detail}`);
      assert.equal(actual[0].retry, 0);
      return { status: child.status, detail };
    };
    const generated = await run('reference', 'base');
    assert.equal(generated.status, 0, generated.detail);
    const original = await readFile(snapshot);
    const slight = await run('test', 'slight');
    assert.equal(slight.status, 0, slight.detail);
    assert.deepEqual(await readFile(snapshot), original, '比较容差内差异不能改写旧图');
    const refreshed = await run('reference', 'slight');
    assert.equal(refreshed.status, 0, refreshed.detail);
    const current = await readFile(snapshot);
    assert.notDeepEqual(current, original, '显式采集必须保存当前图，不能因差异小而保留旧图');
    const compared = await run('test', 'slight');
    assert.equal(compared.status, 0, compared.detail);
    for (const kind of ['defect', 'size', 'business']) {
      const failed = await run('test', kind);
      assert.equal(failed.status, 1, `${kind}: ${failed.detail}`);
      assert.deepEqual(await readFile(snapshot), current, `${kind}不能改写基准`);
    }
    const business = await run('reference', 'business');
    assert.equal(business.status, 1, business.detail);
    assert.deepEqual(await readFile(snapshot), current, '采集也不能接受错误业务状态');
    await rm(snapshot);
    const missing = await run('test', 'base');
    assert.equal(missing.status, 1, missing.detail);
    await assert.rejects(readFile(snapshot), { code: 'ENOENT' }, '普通比较不能创建缺失基准');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
