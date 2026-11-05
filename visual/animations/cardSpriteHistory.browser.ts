/** 用正式 Playwright 编译执行完整历史的时钟适配回归，避免 tsx 助手进入浏览器。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const resolve = createRequire(path.join(__dirname, 'cardSpriteHistory.browser.ts')).resolve;

test('正常和冻结时间的独立完整历史采样均保留运动断言，且不访问基准', /** 验证正常和冻结时间的独立完整历史采样均保留运动断言，且不访问基准。 */ async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-card-history-'));
  try {
    const snapshots = path.join(directory, 'snapshots');
    const configuration = path.join(directory, 'config.mjs');
    await writeFile(configuration, `export default ${JSON.stringify({
      testDir: __dirname, testMatch: 'cardSpriteClockRegression.ts',
      snapshotPathTemplate: `${snapshots}/{arg}{ext}`, outputDir: path.join(directory, 'results'),
      updateSnapshots: 'none', retries: 0, workers: 1, timeout: 30_000,
      use: { viewport: { width: 200, height: 120 } }, reporter: [['list']],
    })};`);
    const execution = spawnSync(process.execPath, [resolve('@playwright/test/cli'), 'test', '--config', configuration],
      { encoding: 'utf8', timeout: 90_000 });
    assert.ifError(execution.error);
    assert.equal(execution.status, 0, execution.stdout + execution.stderr);
    assert.match(execution.stdout, /2 passed/);
    assert.deepEqual(await readdir(snapshots).catch(/** 读取失败时提供空列表，避免诊断采集再次抛错。 */ () => []), [], '取证不得生成任何基准');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
