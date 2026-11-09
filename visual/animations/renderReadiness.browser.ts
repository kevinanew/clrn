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
    const time = await page.evaluate(/** 记录渲染就绪检查前的页面时刻。 */ () => Date.now());
    await page.evaluate(/** 主动滚动窗口，构造页面原点恢复的前置条件。 */ () => window.scrollTo(0, 1));
    assert.equal(await page.evaluate(/** 读取就绪检查前的窗口偏移，确认滚动场景已建立。 */ () => window.scrollY), 1);
    await resetViewportScroll(page);
    assert.equal(await page.evaluate(/** 读取就绪检查后的窗口偏移，核对页面恢复原点。 */ () => window.scrollY), 0);
    assert.equal(await page.evaluate(/** 读取渲染就绪后的时间，验证页面动画仍保持冻结。 */ () => Date.now()), time);
    assert.equal(await page.locator('#sheet').evaluate(/** 读取元素变换矩阵，核对渲染等待没有改变动画位置。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => getComputedStyle(node).transform), 'matrix(1, 0, 0, 1, 0, 16)');
    assert.deepEqual(await page.screenshot(), original);
  } finally { await browser.close(); }
});
