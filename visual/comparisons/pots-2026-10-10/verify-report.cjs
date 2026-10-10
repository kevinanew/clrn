const { chromium, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');

/** 核对真实截图的几何信息、离线图片加载、筛选与差异开关，并导出直观预览。 */
async function main() {
  const measurements = JSON.parse(readFileSync(path.join(__dirname, 'measurements.json'), 'utf8'));
  for (const current of measurements.filter(item => item.version === 'current')) {
    const previous = measurements.find(item => item.version === 'previous' && item.filename === current.filename);
    expect(previous.geometry).toEqual(current.geometry);
    expect(current.geometry.pots.map(item => Number(item.amount))).toEqual(current.pots);
    for (const pot of current.geometry.pots) {
      expect(pot.x).toBeGreaterThanOrEqual(current.geometry.container.x);
      expect(pot.y).toBeGreaterThanOrEqual(current.geometry.container.y);
      expect(pot.x + pot.width).toBeLessThanOrEqual(current.geometry.container.x + current.geometry.container.width);
      expect(pot.y + pot.height).toBeLessThanOrEqual(current.geometry.container.y + current.geometry.container.height);
    }
    expect(new Set(current.geometry.pots.map(pot => pot.y)).size).toBe(Math.ceil(current.pots.length / 2));
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
    await page.goto(pathToFileURL(path.join(__dirname, 'comparison.html')).href);
    await expect(page.locator('#summary')).toContainText('5 行 → 当前 5 行');
    for (const image of await page.locator('.grid img').all()) {
      expect(await image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    }
    await page.screenshot({ path: path.join(__dirname, 'comparison-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '底池放大' }).click();
    await page.getByRole('button', { name: '显示差异' }).click();
    await expect(page.locator('#differencePanel')).toBeVisible();
    await expect(page.locator('#difference')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.grid').screenshot({ path: path.join(__dirname, 'comparison-pots.png') });
    await page.screenshot({ path: path.join(__dirname, 'comparison-details.png'), fullPage: true });
    await page.locator('#device').selectOption('desktop');
    await expect(page.locator('#summary')).toContainText('136 → 136');
    await page.locator('#state').selectOption('full-table-two-pots');
    await expect(page.locator('#summary')).toContainText('1 行 → 当前 1 行');
    console.log('已验证八张截图的底池位置和金额一致、全部底池位于容器内；离线图片和对比控件正常。');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
