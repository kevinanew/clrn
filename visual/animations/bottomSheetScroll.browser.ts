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

test('body 的独立滚动不会使底部关键帧偏移一个像素', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent(`<style>html, body { margin: 0; height: 100%; overflow: hidden }
      #root { height: 813px } #sheet { height: 100px; overflow: auto }
      #content { height: 300px }</style>
      <div id="root"><div id="sheet"><div id="content"></div><button>Cancel</button></div></div>`);
    await page.evaluate(() => { document.body.scrollTop = 1; });
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.equal(await page.evaluate(() => document.body.scrollTop), 1);
    await lockBottomSheetDocumentScroll(page);
    await page.evaluate(() => {
      document.body.scrollTop = 1;
      document.querySelector('button')!.focus();
    });
    assert.equal(await page.evaluate(() => document.body.scrollTop), 0);
    assert.equal(await page.locator('#root').evaluate(node => node.getBoundingClientRect().y), 0);
    assert.ok(await page.locator('#sheet').evaluate(node => node.scrollTop) > 0);
  } finally { await browser.close(); }
});

test('导航祖先的独立滚动不会移动整幅画面，内部列表仍可滚动', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent(`<style>html, body { margin: 0; height: 100%; overflow: hidden }
      #root { position: relative; height: 812px; overflow: hidden } #shell { height: 813px }
      #list { height: 100px; overflow: auto } #content { height: 300px }
      #navigation { position: absolute; top: 762px; height: 50px }</style>
      <div id="root"><div id="shell">
        <div id="list"><div id="content"></div><button>Cancel</button></div>
        <div id="navigation"><button data-testid="private-room-tab">Private game</button></div>
      </div></div>`);
    const original = await page.screenshot();
    await page.evaluate(() => { document.querySelector('#root')!.scrollTop = 1; });
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.equal(await page.evaluate(() => document.body.scrollTop), 0);
    assert.equal(await page.locator('#root').evaluate(node => node.scrollTop), 1);
    assert.equal(await page.locator('#navigation').evaluate(node => node.getBoundingClientRect().y), 761);
    await lockBottomSheetDocumentScroll(page);
    assert.deepEqual(await page.screenshot(), original);
    await page.evaluate(() => {
      document.querySelector('#root')!.scrollTop = 1;
      document.querySelector<HTMLButtonElement>('#list button')!.focus();
    });
    assert.equal(await page.locator('#root').evaluate(node => node.scrollTop), 0);
    assert.equal(await page.locator('#navigation').evaluate(node => node.getBoundingClientRect().y), 762);
    assert.ok(await page.locator('#list').evaluate(node => node.scrollTop) > 0);
  } finally { await browser.close(); }
});
