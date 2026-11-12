import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, type Page } from '@playwright/test';
import { lockBottomSheetDocumentScroll } from './bottomSheetScroll';

/** 截图失败时只采集固定布局数值，不重试截图或覆盖原始异常。
 * @param page - 当前隔离测试页面。
 */
async function captureScrollFixture(page: Page): Promise<Buffer> {
  try {
    return await page.screenshot();
  } catch (error) {
    await reportScrollCaptureFailure(page);
    throw error;
  }
}

/** 有界采集截图失败时的页面状态，任何诊断异常均不传播。
 * @param page - 截图失败的隔离页面。
 */
async function reportScrollCaptureFailure(page: Page): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const layout = await Promise.race([
      page.evaluate(/** 只读取视口、文档尺寸和可见性，不读取页面正文。 */ () => ({
        width: innerWidth, height: innerHeight, scale: devicePixelRatio,
        documentWidth: document.documentElement.clientWidth,
        documentHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        visibility: document.visibilityState,
        ready: document.readyState,
      })),
      new Promise<null>(/** 限制失败诊断耗时，超时仍保留截图异常。
       * @param resolve - 结束诊断等待。 */ resolve => { timer = setTimeout(/** 诊断超时只返回空状态。 */ () => resolve(null), 1000); }),
    ]);
    console.error('scroll-fixture screenshot failure', JSON.stringify({
      closed: page.isClosed(), connected: page.context().browser()?.isConnected(), layout,
    }));
  } catch { /* 诊断失败不得覆盖原始截图异常。 */ }
  finally { clearTimeout(timer); }
}

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
    assert.equal(await page.locator('#navigation').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 1);
    await lockBottomSheetDocumentScroll(page, entrance);
    await page.evaluate(/** 恢复入口焦点并滚动各层容器，构造 Bottom Sheet 回弹场景。 */ () => {
      document.querySelector<HTMLElement>('#entrance')!.blur();
      document.querySelector<HTMLElement>('#entrance')!.focus();
      for (const id of ['navigation', 'list', 'sheet']) document.getElementById(id)!.scrollTop = 1;
    });
    assert.equal(await page.locator('#navigation').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 0);
    assert.equal(await page.locator('#screen').evaluate(/** 在页面中读取`node.getBoundingClientRect().y`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 0);
    for (const id of ['list', 'sheet']) {
      assert.equal(await page.locator(`#${id}`).evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
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
    await page.evaluate(/** 在页面中读取`window.scrollTo(0, 1)`，供测试判断当前界面状态。 */ () => window.scrollTo(0, 1));
    assert.equal(await page.evaluate(/** 在页面中读取`window.scrollY`，供测试判断当前界面状态。 */ () => window.scrollY), 1);
    await lockBottomSheetDocumentScroll(page);
    await page.evaluate(/** 滚动窗口并聚焦按钮，制造焦点恢复引起的页面位移。 */ () => {
      window.scrollTo(0, 1);
      document.querySelector('button')!.focus();
    });
    assert.equal(await page.evaluate(/** 在页面中读取`window.scrollY`，供测试判断当前界面状态。 */ () => window.scrollY), 0);
    assert.ok(await page.locator('#sheet').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
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
    assert.equal(await page.evaluate(/** 在页面中读取`window.scrollY`，供测试判断当前界面状态。 */ () => window.scrollY), 0);
    assert.equal(await page.evaluate(/** 在页面中读取`document.body.scrollTop`，供测试判断当前界面状态。 */ () => document.body.scrollTop), 1);
    await lockBottomSheetDocumentScroll(page);
    await page.evaluate(/** 同时改变 body 滚动与焦点，验证截图视口保持固定。 */ () => {
      document.body.scrollTop = 1;
      document.querySelector('button')!.focus();
    });
    assert.equal(await page.evaluate(/** 在页面中读取`document.body.scrollTop`，供测试判断当前界面状态。 */ () => document.body.scrollTop), 0);
    assert.equal(await page.locator('#root').evaluate(/** 在页面中读取`node.getBoundingClientRect().y`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 0);
    assert.ok(await page.locator('#sheet').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
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
    const original = await captureScrollFixture(page);
    await page.evaluate(/** 滚动根容器，验证根节点的程序滚动会被发现。 */ () => { document.querySelector('#root')!.scrollTop = 1; });
    assert.equal(await page.evaluate(/** 在页面中读取`window.scrollY`，供测试判断当前界面状态。 */ () => window.scrollY), 0);
    assert.equal(await page.evaluate(/** 在页面中读取`document.body.scrollTop`，供测试判断当前界面状态。 */ () => document.body.scrollTop), 0);
    assert.equal(await page.locator('#root').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 1);
    assert.equal(await page.locator('#navigation').evaluate(/** 在页面中读取`node.getBoundingClientRect().y`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 761);
    await lockBottomSheetDocumentScroll(page);
    assert.deepEqual(await captureScrollFixture(page), original);
    await page.evaluate(/** 滚动根容器并聚焦列表按钮，复现焦点恢复导致的位移。 */ () => {
      document.querySelector('#root')!.scrollTop = 1;
      document.querySelector<HTMLButtonElement>('#list button')!.focus();
    });
    assert.equal(await page.locator('#root').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop), 0);
    assert.equal(await page.locator('#navigation').evaluate(/** 在页面中读取`node.getBoundingClientRect().y`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.getBoundingClientRect().y), 762);
    assert.ok(await page.locator('#list').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop) > 0);
  } finally { await browser.close(); }
});
