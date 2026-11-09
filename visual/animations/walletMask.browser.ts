import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';
import { chromium, type Locator, type Page } from '@playwright/test';
import { assertProcessStatus, snapshotContents, assertSnapshotsUnchanged } from './timelineBrowserSupport';
import { PNG } from 'pngjs';
import { maskNumericFields } from './numericMask';
import { slotWalletMask } from './slotWallet';

/**
 * 展开真实 Playwright 运行结果。
 * @param suites - 子进程 JSON 报告。
 */
function results(suites: JSONReportSuite[]): { title: string; result: JSONReportSuite['specs'][number]['tests'][number]['results'][number] }[] {
  return suites.flatMap(/** 递归汇总钱包遮罩浏览器测试的标题及运行结果。
 * @param suite - 当前操作使用的 suite。 */ suite => [...suite.specs.flatMap(/** 展开当前条目对应的`spec.tests.flatMap(item => item.results.map(result => ({ title: spec.title, result })))`。
 * @param spec - 当前操作使用的 spec。 */ spec => spec.tests.flatMap(/** 展开当前条目对应的`item.results.map(result => ({ title: spec.title, result }))`。
 * @param item - 当前遍历的条目。 */ item =>
    item.results.map(/** 把遮罩用例标题与执行结果关联，定位失败场景。
 * @param result - 当前操作使用的 result。 */ result => ({ title: spec.title, result })))), ...results(suite.suites || [])]);
}

test('双视口全部入退场与奖励帧忽略余额变化，布局、动画、节点缺失和错误数据仍失败', /** 验证双视口全部入退场与奖励帧忽略余额变化，布局、动画、节点缺失和错误数据仍失败。 */ async () => {
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
     * @param unmasked - 先种入一张桌面真实数字旧基准，验证小区域也能被显式更新。
     */
    const run = (compare: boolean, unmasked = false) => spawnSync(process.execPath,
      [cli, 'test', '--config', config, ...(compare ? [] : ['--update-snapshots']),
        ...walletProjectArguments(unmasked)],
      { encoding: 'utf8', timeout: 240_000,
        env: { ...process.env, WALLET_MASK_COMPARISON: String(compare), WALLET_MASK_UNMASKED: String(unmasked) } });
    const oldBaseline = run(false, true);
    assertProcessStatus(oldBaseline, 0);
    const desktopFrame = path.join(snapshots, 'en-desktop-wallet-balance-exit-0ms.png');
    const unmasked = await readFile(desktopFrame);
    const baseline = run(false);
    assertProcessStatus(baseline, 0);
    const updated = await readFile(desktopFrame);
    assert.ok(!updated.equals(unmasked), '显式更新必须替换小于整图 0.5% 的桌面余额区');
    const bitmap = PNG.sync.read(updated);
    assertSmallMask(bitmap);
    const before = await snapshotContents(snapshots);
    const comparison = run(true);
    assertProcessStatus(comparison, 1);
    const report: JSONReport = JSON.parse(await readFile(reportPath, 'utf8'));
    const entries = results(report.suites);
    assert.equal(entries.length, 10);
    assertComparisonResults(entries);
    await assertSnapshotsUnchanged(snapshots, before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('数字遮罩保留图标像素，支持裁切和缩放，透明、移出视口或卸载后没有残留', /** 验证数字遮罩保留图标像素，支持裁切和缩放，透明、移出视口或卸载后没有残留。 */ async () => {
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
    await assertWalletScales(page, panel, masks, clip);
    for (const style of ['opacity:0', 'transform:translateY(1000px)', 'display:none']) {
      await panel.evaluate(/** 应用当前测试样式，制造面板位移或变换场景。
 * @param node - 当前遍历的 DOM 或语法节点。
 * @param style - 当前操作使用的 style。 */ (node, style) => { (node as HTMLElement).style.cssText += `;${style}`; }, style);
      const original = await page.screenshot({ clip });
      assert.deepEqual(PNG.sync.read((await maskNumericFields(original, masks, clip)).png).data, PNG.sync.read(original).data);
      await panel.evaluate(/** 清除钱包面板测试样式，恢复下一项检查的初始布局。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => { (node as HTMLElement).style.cssText = ''; });
    }
    await panel.locator('.number').first().evaluate(/** 移除遮罩测试中的目标节点，验证节点卸载时的恢复行为。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.remove());
    await assert.rejects(maskNumericFields(await page.screenshot({ clip }), masks, clip), /数字节点必须完整/);
    await panel.evaluate(/** 移除遮罩测试中的另一个节点，核对重复卸载处理。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.remove());
    const original = await page.screenshot({ clip });
    assert.deepEqual(PNG.sync.read((await maskNumericFields(original, masks, clip)).png).data, PNG.sync.read(original).data);
  } finally { await browser.close(); }
});

/**
 * 数字区域外的图标、边缘及背景像素必须原样保留。
 * @param actual - 遮罩后的像素。
 * @param before - 原始像素。
 * @param boxes - 数字区域。
 * @param scale - 当前缩放。
 * @param clip - 截图裁切。
 */
function assertOutsideMaskUnchanged(actual: PNG, before: PNG,
  boxes: { x: number; y: number; right: number; bottom: number }[], scale: number, clip: { x: number; y: number }) {
  for (let y = 0; y < actual.height; y++) assertOutsideMaskRow(actual, before, boxes, scale, clip, y);
}

/**
 * 检查余额变化被忽略，同时保留布局、运动、节点和数据失败。
 * @param entries - 展开的真实测试结果。
 */
function assertComparisonResults(entries: ReturnType<typeof results>) {
  for (const entry of entries) assertComparisonEntry(entry);
}

/**
 * 每个场景明确登记完成状态、差异图和未遮罩证据要求。
 * @param entry - 真实运行结果。
 */
function assertComparisonEntry({ title, result }: ReturnType<typeof results>[number]) {
  const expectations: Record<string, { status: string; complete: boolean; diff: boolean; originals: number }> = {
    'wallet mask balance': { status: 'passed', complete: true, diff: false, originals: 16 },
    'wallet mask layout': { status: 'failed', complete: true, diff: true, originals: 0 },
    'wallet mask animation': { status: 'failed', complete: true, diff: true, originals: 0 },
    'wallet mask missing': { status: 'failed', complete: false, diff: false, originals: 0 },
    'wallet mask data': { status: 'failed', complete: false, diff: false, originals: 0 },
  };
  const expected = expectations[title];
  assert.equal(result.status, expected.status, `${title}: ${result.errors.map(/** 保留每个真实错误的诊断。
   * @param error - 原运行错误。 */ error => error.message).join('\n')}`);
  assert.equal(result.attachments.some(/** 检查全部阶段完成标记。
   * @param item - 报告附件。 */ item => item.name === 'wallet-complete'), expected.complete,
    '像素差异仍采集完整时间线，控件和数据断言仍立即中止');
  if (expected.diff) assert.ok(result.attachments.some(/** 检查真实变化的像素差异图。
   * @param item - 报告附件。 */ item => item.name.includes('-diff')), '真实变化须报告像素差异');
  if (expected.originals) assert.equal(result.attachments.filter(/** 保留所有原始未遮罩证据。
   * @param item - 报告附件。 */ item => item.name.endsWith('-unmasked')).length,
    expected.originals, '全部入场、退场与奖励帧保留未遮罩证据');
}

/**
 * 检查小于整图容差的数字区仍已写入遮罩。
 * @param bitmap - 更新后的基准像素。
 */
function assertSmallMask(bitmap: PNG) {
  let magenta = 0;
  for (let offset = 0; offset < bitmap.data.length; offset += 4) {
    if (isMagenta(bitmap.data.subarray(offset, offset + 3))) magenta++;
  }
  assertSmallMaskArea(magenta, bitmap);
}

/**
 * 对照旧桌面真实数字图，仍只在显式种图时选择该用例。
 * @param unmasked - 是否种入未遮罩的桌面基准。
 */
function walletProjectArguments(unmasked: boolean) {
  return unmasked ? ['--project=desktop', '--grep=wallet mask balance$'] : [];
}

type WalletClip = { x: number; y: number; width: number; height: number };
type WalletMasks = ReturnType<typeof slotWalletMask>;

/**
 * 在两个原始缩放比例上重复核对所有余额位数。
 * @param page - 本地夹具页面。
 * @param panel - 钱包面板。
 * @param masks - 实际数字遮罩。
 * @param clip - 原裁切。
 */
async function assertWalletScales(page: Page, panel: Locator, masks: WalletMasks, clip: WalletClip) {
  for (const scale of [1, 0.65]) {
    await panel.evaluate(/** 缩放钱包面板，验证数字遮罩的坐标换算。
 * @param node - 当前遍历的 DOM 或语法节点。
 * @param scale - 当前操作使用的 scale。 */ (node, scale) => { (node as HTMLElement).style.transform = `scale(${scale})`; }, scale);
    await assertMaskedBalances(page, panel, masks, clip, scale);
  }
}

/**
 * 每个缩放比例下逐像素核对数字外区域以及不同位数的遮罩结果。
 * @param page - 本地夹具页面。
 * @param panel - 钱包面板。
 * @param masks - 实际数字遮罩。
 * @param clip - 原裁切。
 * @param scale - 当前比例。
 */
async function assertMaskedBalances(page: Page, panel: Locator, masks: WalletMasks, clip: WalletClip, scale: number) {
  let first: Buffer | undefined;
  for (const texts of [['0', '0'], ['7', '9'], ['999,999,999', '99,999'], ['123', '456']]) {
    await panel.locator('.number').evaluateAll(/** 将测试数字写入钱包节点，构造不同长度的余额内容。
 * @param nodes - 当前匹配的页面节点集合。
 * @param texts - 当前操作使用的 texts。 */ (nodes, texts) => nodes.forEach(/** 按索引设置当前钱包数字的显示文本。
 * @param node - 当前遍历的 DOM 或语法节点。
 * @param index - 当前条目在集合中的位置。 */ (node, index) => { node.textContent = texts[index]; }), texts);
    const original = await page.screenshot({ clip, scale: 'css' });
    const masked = await maskNumericFields(original, masks, clip);
    const actual = PNG.sync.read(masked.png);
    const before = PNG.sync.read(original);
    const boxes = await panel.locator('.number').evaluateAll(/** 读取钱包数字节点的真实边界，用于核对遮罩区域。
 * @param nodes - 当前匹配的页面节点集合。 */ nodes => nodes.map(/** 读取所有目标节点的边界矩形，核对遮罩覆盖范围。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().toJSON()));
    assertOutsideMaskUnchanged(actual, before, boxes, scale, clip);
    assert.deepEqual(actual.data, first ?? actual.data, '不同位数的余额必须得到完全相同的遮罩图');
    first = actual.data;
  }
}

/**
 * 一行内仅数字遮罩中的像素允许改变。
 * @param actual - 遮罩后的像素。
 * @param before - 原始像素。
 * @param boxes - 数字矩形。
 * @param scale - 当前缩放比例。
 * @param clip - 原裁切偏移。
 * @param y - 当前行。
 */
function assertOutsideMaskRow(actual: PNG, before: PNG, boxes: MaskBox[], scale: number, clip: { x: number; y: number }, y: number) {
  for (let x = 0; x < actual.width; x++) {
    if (boxes.some(/** 检查当前像素是否在原数字遮罩内。
     * @param box - 实际数字矩形。 */ box => insideMask(box, scale, clip, x, y))) continue;
    const offset = (y * actual.width + x) * 4;
    assert.ok(actual.data.subarray(offset, offset + 4).equals(before.data.subarray(offset, offset + 4)),
      '数字区域外的图标、边缘及背景像素必须原样保留');
  }
}

type MaskBox = { x: number; y: number; right: number; bottom: number };

/**
 * 将带阴影边距的遮罩按原取整规则投影到裁切图片。
 * @param box - 实际数字边界。
 * @param scale - 当前缩放比例。
 * @param clip - 裁切偏移。
 * @param x - 当前列。
 * @param y - 当前行。
 */
function insideMask(box: MaskBox, scale: number, clip: { x: number; y: number }, x: number, y: number) {
  return insideAxis(x, box.x, box.right, scale, clip.x) && insideAxis(y, box.y, box.bottom, scale, clip.y);
}

/**
 * 每个轴保留原 4px 阴影边距与向外取整。
 * @param value - 当前像素坐标。
 * @param start - 原起点。
 * @param end - 原终点。
 * @param scale - 当前缩放比例。
 * @param offset - 裁切偏移。
 */
function insideAxis(value: number, start: number, end: number, scale: number, offset: number) {
  return value >= Math.floor(start - 4 * scale - offset) && value < Math.ceil(end + 4 * scale - offset);
}

/**
 * 精确核对洋红色的三个通道。
 * @param rgb - 当前像素前三个字节。
 */
function isMagenta(rgb: Buffer) { return rgb.equals(Buffer.from([255, 0, 255])); }

/**
 * 原遮罩面积须非零且小于整图阈值。
 * @param magenta - 遮罩像素数。
 * @param bitmap - 实际图片。
 */
function assertSmallMaskArea(magenta: number, bitmap: PNG) {
  assert.ok(magenta > 0 && magenta < bitmap.width * bitmap.height * 0.005, '使用低于整图阈值的真实遮罩面积');
}
