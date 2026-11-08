import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertProcessStatus } from './timelineBrowserSupport';

test('固定 Chromium 验证 CSS 时间线起点、完成恢复和两种预热方式', /** 通过与正式动画相同的 Playwright 转译及浏览器入口验证生命周期。 */ async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-timeline-clock-'));
  try {
    const config = path.join(directory, 'playwright.config.mjs');
    await writeFile(config, `export default ${JSON.stringify({
      testDir: __dirname, testMatch: 'timelineClockRegression.ts',
      outputDir: path.join(directory, 'results'), workers: 1, retries: 0, timeout: 30_000,
      reporter: 'list',
    })};`);
    const cli = createRequire(path.join(__dirname, 'timelineClock.browser.ts')).resolve('@playwright/test/cli');
    const result = spawnSync(process.execPath, [cli, 'test', '--config', config],
      { encoding: 'utf8', timeout: 60_000 });
    assertProcessStatus(result, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
