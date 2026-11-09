import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { lockBottomSheetDocumentScroll } from './bottomSheetScroll';

test('焦点恢复不能滚动嵌套的 RN Web 导航容器，列表和弹层仍可滚动', /** 验证焦点恢复不能滚动嵌套的 RN Web 导航容器，列表和弹层仍可滚动。 */ async () => {
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
    assert.equal(await page.locator('#navigation').evaluate(/** 读取导航容器的初始滚动量，确认焦点引发了一像素偏移。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 1);
    await lockBottomSheetDocumentScroll(page, entrance);
    await page.evaluate(/** 恢复入口焦点并滚动各层容器，构造 Bottom Sheet 回弹场景。 */ () => {
      document.querySelector<HTMLElement>('#entrance')!.blur();
      document.querySelector<HTMLElement>('#entrance')!.focus();
      for (const id of ['navigation', 'list', 'sheet']) document.getElementById(id)!.scrollTop = 1;
    });
    assert.equal(await page.locator('#navigation').evaluate(/** 读取锁定后的导航滚动量，核对容器已恢复原点。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 0);
    assert.equal(await page.locator('#screen').evaluate(/** 读取主屏幕纵向位置，核对底部弹层没有推移页面。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 0);
    for (const id of ['list', 'sheet']) {
      assert.equal(await page.locator(`#${id}`).evaluate(/** 读取列表及弹层内部滚动量，确认内部滚动仍可用。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 1);
    }
  } finally { await browser.close(); }
});

test('底部弹层预热后文档仍固定在视口原点，内部容器可以滚动', /** 验证底部弹层预热后文档仍固定在视口原点，内部容器可以滚动。 */ async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent(`<style>body { margin: 0; height: 813px }
      #sheet { height: 100px; overflow: auto } #content { height: 300px }</style>
      <div id="sheet"><div id="content"></div><button>Cancel</button></div>`);
    await page.evaluate(/** 主动滚动窗口一像素，构造文档锁定的回归场景。 */ () => window.scrollTo(0, 1));
    assert.equal(await page.evaluate(/** 读取锁定前的窗口偏移，确认回归前置条件成立。 */ () => window.scrollY), 1);
    await lockBottomSheetDocumentScroll(page);
    await page.evaluate(/** 滚动窗口并聚焦按钮，制造焦点恢复引起的页面位移。 */ () => {
      window.scrollTo(0, 1);
      document.querySelector('button')!.focus();
    });
    assert.equal(await page.evaluate(/** 读取锁定后的窗口偏移，确认文档保持在视口原点。 */ () => window.scrollY), 0);
    assert.ok(await page.locator('#sheet').evaluate(/** 读取弹层内部滚动量，确认文档锁定没有禁止内部滚动。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop) > 0);
  } finally { await browser.close(); }
});

test('body 的独立滚动不会使底部关键帧偏移一个像素', /** 验证body 的独立滚动不会使底部关键帧偏移一个像素。 */ async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent(`<style>html, body { margin: 0; height: 100%; overflow: hidden }
      #root { height: 813px } #sheet { height: 100px; overflow: auto }
      #content { height: 300px }</style>
      <div id="root"><div id="sheet"><div id="content"></div><button>Cancel</button></div></div>`);
    await page.evaluate(/** 将 body 滚动一像素，验证锁定对程序滚动的约束。 */ () => { document.body.scrollTop = 1; });
    assert.equal(await page.evaluate(/** 读取窗口偏移，核对 body 独立滚动场景的文档位置。 */ () => window.scrollY), 0);
    assert.equal(await page.evaluate(/** 读取 body 的初始滚动量，记录锁定前的位置。 */ () => document.body.scrollTop), 1);
    await lockBottomSheetDocumentScroll(page);
    await page.evaluate(/** 同时改变 body 滚动与焦点，验证截图视口保持固定。 */ () => {
      document.body.scrollTop = 1;
      document.querySelector('button')!.focus();
    });
    assert.equal(await page.evaluate(/** 读取锁定后的 body 偏移，核对独立滚动已复位。 */ () => document.body.scrollTop), 0);
    assert.equal(await page.locator('#root').evaluate(/** 读取目标元素的纵向位置，检查 body 滚动未影响关键帧。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 0);
    assert.ok(await page.locator('#sheet').evaluate(/** 读取目标容器的滚动量，核对内部滚动行为。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop) > 0);
  } finally { await browser.close(); }
});

test('导航祖先的独立滚动不会移动整幅画面，内部列表仍可滚动', /** 验证导航祖先的独立滚动不会移动整幅画面，内部列表仍可滚动。 */ async () => {
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
    await page.evaluate(/** 滚动根容器，验证根节点的程序滚动会被发现。 */ () => { document.querySelector('#root')!.scrollTop = 1; });
    assert.equal(await page.evaluate(/** 读取文档滚动量，核对嵌套滚动场景下的窗口位置。 */ () => window.scrollY), 0);
    assert.equal(await page.evaluate(/** 读取 body 滚动量，核对嵌套滚动场景下的根层位置。 */ () => document.body.scrollTop), 0);
    assert.equal(await page.locator('#root').evaluate(/** 读取内部容器滚动量，记录锁定前的滚动状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 1);
    assert.equal(await page.locator('#navigation').evaluate(/** 读取底部导航的纵向位置，确认根容器滚动造成了偏移。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 761);
    await lockBottomSheetDocumentScroll(page);
    assert.deepEqual(await page.screenshot(), original);
    await page.evaluate(/** 滚动根容器并聚焦列表按钮，复现焦点恢复导致的位移。 */ () => {
      document.querySelector('#root')!.scrollTop = 1;
      document.querySelector<HTMLButtonElement>('#list button')!.focus();
    });
    assert.equal(await page.locator('#root').evaluate(/** 读取内部容器的恢复位置，核对滚动锁定效果。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 0);
    assert.equal(await page.locator('#navigation').evaluate(/** 读取锁定后的底部导航位置，核对布局恢复到原始坐标。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 762);
    assert.ok(await page.locator('#list').evaluate(/** 读取文档锁定后的列表偏移，确认内部滚动仍可用。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop) > 0);
  } finally { await browser.close(); }
});
