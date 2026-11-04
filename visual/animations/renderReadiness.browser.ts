import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { resetViewportScroll } from './renderReadiness';

test('弹层采样恢复一像素根滚动，不改变动画时刻及元素布局', /** 验证弹层采样恢复一像素根滚动，不改变动画时刻及元素布局。 */ async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.setContent('<style>body{margin:0;height:813px}#sheet{position:absolute;top:600px;width:375px;height:100px;background:gold;transform:translateY(16px)}</style><div id="sheet"></div>');
    const original = await page.screenshot();
    const time = await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now());
    await page.evaluate(/** 在页面中读取`window.scrollTo(0, 1)`，供测试判断当前界面状态。 */ () => window.scrollTo(0, 1));
    assert.equal(await page.evaluate(/** 在页面中读取`window.scrollY`，供测试判断当前界面状态。 */ () => window.scrollY), 1);
    await resetViewportScroll(page);
    assert.equal(await page.evaluate(/** 在页面中读取`window.scrollY`，供测试判断当前界面状态。 */ () => window.scrollY), 0);
    assert.equal(await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now()), time);
    assert.equal(await page.locator('#sheet').evaluate(/** 在页面中读取`getComputedStyle(node).transform`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => getComputedStyle(node).transform), 'matrix(1, 0, 0, 1, 0, 16)');
    assert.deepEqual(await page.screenshot(), original);
  } finally { await browser.close(); }
});
