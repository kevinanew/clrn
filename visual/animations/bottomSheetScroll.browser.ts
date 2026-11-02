import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { lockBottomSheetDocumentScroll } from './bottomSheetScroll';

test('底部弹层预热后文档仍固定在视口原点，内部容器可以滚动', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent(`<style>body { margin: 0; height: 813px }
      #sheet { height: 100px; overflow: auto } #content { height: 300px }</style>
      <div id="sheet"><div id="content"></div><button>Cancel</button></div>`);
    await page.evaluate(() => window.scrollTo(0, 1));
    assert.equal(await page.evaluate(() => window.scrollY), 1);
    await lockBottomSheetDocumentScroll(page);
    await page.evaluate(() => {
      window.scrollTo(0, 1);
      document.querySelector('button')!.focus();
    });
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.ok(await page.locator('#sheet').evaluate(node => node.scrollTop) > 0);
  } finally { await browser.close(); }
});
