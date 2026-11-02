import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { lockBottomSheetDocumentScroll } from './bottomSheetScroll';

test('焦点恢复不能滚动嵌套的 RN Web 导航容器，列表和弹层仍可滚动', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent(`<style>
      html, body { margin: 0; height: 100%; overflow: hidden }
      #navigation { height: 812px; overflow: hidden }
      #screen { height: 813px; position: relative }
      #entrance { position: absolute; bottom: 0 }
      .scrollable { height: 100px; overflow: auto }
      .content { height: 300px }
      </style><div id="navigation"><div id="screen">
      <div id="list" class="scrollable"><div class="content"></div></div>
      <button id="entrance">Create game</button>
      </div></div>
      <div id="sheet" class="scrollable"><div class="content"></div></div>`);
    const entrance = page.locator('#entrance');
    await entrance.focus();
    assert.equal(await page.locator('#navigation').evaluate(node => node.scrollTop), 1);
    await lockBottomSheetDocumentScroll(page, entrance);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#entrance')!.blur();
      document.querySelector<HTMLElement>('#entrance')!.focus();
      for (const id of ['navigation', 'list', 'sheet']) document.getElementById(id)!.scrollTop = 1;
    });
    assert.equal(await page.locator('#navigation').evaluate(node => node.scrollTop), 0);
    assert.equal(await page.locator('#screen').evaluate(node => node.getBoundingClientRect().y), 0);
    for (const id of ['list', 'sheet']) {
      assert.equal(await page.locator(`#${id}`).evaluate(node => node.scrollTop), 1);
    }
  } finally { await browser.close(); }
});

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
