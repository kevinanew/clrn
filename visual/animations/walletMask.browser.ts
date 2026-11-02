import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { maskNumericFields } from './numericMask';
import { slotWalletMask } from './slotWallet';

/**
 * 展开真实 Playwright 运行结果。
 * @param suites - 子进程 JSON 报告。
 */
function results(suites: JSONReportSuite[]): { title: string; result: JSONReportSuite['specs'][number]['tests'][number]['results'][number] }[] {
  return suites.flatMap(suite => [...suite.specs.flatMap(spec => spec.tests.flatMap(item =>
    item.results.map(result => ({ title: spec.title, result })))), ...results(suite.suites || [])]);
}

test('双视口全部入退场与奖励帧忽略余额变化，布局、动画、节点缺失和错误数据仍失败', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-wallet-mask-'));
  try {
    const snapshots = path.join(directory, 'snapshots');
    const reportPath = path.join(directory, 'report.json');
    const config = path.join(directory, 'playwright.config.mjs');
    await writeFile(config, `export default ${JSON.stringify({
      testDir: __dirname, testMatch: 'walletMaskRegression.ts', outputDir: path.join(directory, 'results'),
      snapshotPathTemplate: `${snapshots}/{arg}{ext}`, updateSnapshots: 'none',
      workers: 1, retries: 0, timeout: 60_000, reporter: [['json', { outputFile: reportPath }]],
      projects: [{ name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
        { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }],
    })};`);
    const cli = createRequire(path.join(__dirname, 'walletMask.browser.ts')).resolve('@playwright/test/cli');
    /**
     * 首轮生成临时基准，第二轮改变余额及指定故障，保留真实退出码。
     * @param compare - 是否运行不同余额和故障注入。
     */
    const run = (compare: boolean) => spawnSync(process.execPath,
      [cli, 'test', '--config', config, ...(compare ? [] : ['--update-snapshots'])],
      { encoding: 'utf8', timeout: 240_000, env: { ...process.env, WALLET_MASK_COMPARISON: String(compare) } });
    const baseline = run(false);
    assert.equal(baseline.status, 0, baseline.error?.message || baseline.stdout + baseline.stderr);
    const before = new Map(await Promise.all((await readdir(snapshots)).map(async name =>
      [name, await readFile(path.join(snapshots, name))] as const)));
    const comparison = run(true);
    assert.equal(comparison.status, 1, comparison.error?.message || comparison.stdout + comparison.stderr);
    const report: JSONReport = JSON.parse(await readFile(reportPath, 'utf8'));
    const entries = results(report.suites);
    assert.equal(entries.length, 10);
    for (const { title, result } of entries) {
      assert.equal(result.status, title === 'wallet mask balance' ? 'passed' : 'failed',
        `${title}: ${result.errors.map(error => error.message).join('\n')}`);
      if (title === 'wallet mask balance') {
        assert.ok(result.attachments.some(item => item.name === 'wallet-complete'));
        const originals = result.attachments.filter(item => item.name.endsWith('-unmasked'));
        assert.equal(originals.length, 16, '全部入场、退场与奖励帧保留未遮罩证据');
      }
      if (title === 'wallet mask layout' || title === 'wallet mask animation') {
        assert.ok(result.attachments.some(item => item.name.includes('-diff')), '真实变化须报告像素差异');
        assert.ok(result.attachments.some(item => item.name === 'wallet-complete'), '像素差异仍采集完整时间线');
      }
      if (title === 'wallet mask missing' || title === 'wallet mask data') {
        assert.ok(!result.attachments.some(item => item.name === 'wallet-complete'), '控件和数据断言仍立即中止');
      }
    }
    for (const [name, contents] of before) assert.deepEqual(await readFile(path.join(snapshots, name)), contents);
    assert.equal((await readdir(snapshots)).length, before.size, '普通比较不创建基准');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('数字遮罩保留图标像素，支持裁切和缩放，透明、移出视口或卸载后没有残留', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
    await page.setContent(`<style>
      body { margin:0; background:white; }
      #panel { position:absolute; top:40px; left:10px; width:350px; height:50px; background:purple; transform-origin:top left; }
      .icon { position:absolute; top:5px; left:0; width:30px; height:30px; background:gold; }
      .number { position:absolute; top:10px; left:40px; width:110px; height:20px;
        font:bold 16px sans-serif; text-align:center; color:gold; text-shadow:2px 2px 5px black; }
      #diamond { left:210px; width:75px; } #diamond-icon { left:175px; background:cyan; }
    </style><div id="panel" data-testid="slot-machine-view"><div data-testid="top-toolbar">
      <div class="icon"></div><div class="number">0</div>
      <div class="icon" id="diamond-icon"></div><div class="number" id="diamond">0</div>
    </div></div>`);
    const panel = page.getByTestId('slot-machine-view');
    const masks = slotWalletMask(panel);
    const clip = { x: 5, y: 20, width: 360, height: 120 };
    for (const scale of [1, 0.65]) {
      await panel.evaluate((node, scale) => { (node as HTMLElement).style.transform = `scale(${scale})`; }, scale);
      let first: Buffer | undefined;
      for (const texts of [['0', '0'], ['7', '9'], ['999,999,999', '99,999'], ['123', '456']]) {
        await panel.locator('.number').evaluateAll((nodes, texts) => nodes.forEach((node, index) => { node.textContent = texts[index]; }), texts);
        const original = await page.screenshot({ clip, scale: 'css' });
        const masked = await maskNumericFields(original, masks, clip);
        const actual = PNG.sync.read(masked.png);
        const before = PNG.sync.read(original);
        const boxes = await panel.locator('.number').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
        for (let y = 0; y < actual.height; y++) {
          for (let x = 0; x < actual.width; x++) {
            if (boxes.some(box => x >= Math.floor(box.x - 4 * scale - clip.x)
              && x < Math.ceil(box.right + 4 * scale - clip.x) && y >= Math.floor(box.y - 4 * scale - clip.y)
              && y < Math.ceil(box.bottom + 4 * scale - clip.y))) continue;
            const offset = (y * actual.width + x) * 4;
            assert.ok(actual.data.subarray(offset, offset + 4).equals(before.data.subarray(offset, offset + 4)),
              '数字区域外的图标、边缘及背景像素必须原样保留');
          }
        }
        if (first) assert.deepEqual(actual.data, first, '不同位数的余额必须得到完全相同的遮罩图');
        first = actual.data;
      }
    }
    for (const style of ['opacity:0', 'transform:translateY(1000px)', 'display:none']) {
      await panel.evaluate((node, style) => { (node as HTMLElement).style.cssText += `;${style}`; }, style);
      const original = await page.screenshot({ clip });
      assert.deepEqual(PNG.sync.read((await maskNumericFields(original, masks, clip)).png).data, PNG.sync.read(original).data);
      await panel.evaluate(node => { (node as HTMLElement).style.cssText = ''; });
    }
    await panel.locator('.number').first().evaluate(node => node.remove());
    await assert.rejects(maskNumericFields(await page.screenshot({ clip }), masks, clip), /数字节点必须完整/);
    await panel.evaluate(node => node.remove());
    const original = await page.screenshot({ clip });
    assert.deepEqual(PNG.sync.read((await maskNumericFields(original, masks, clip)).png).data, PNG.sync.read(original).data);
  } finally { await browser.close(); }
});
