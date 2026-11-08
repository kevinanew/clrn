import assert from 'node:assert/strict';
import { test, type Page } from '../src/support/diagnosticTest';
import { restoreCssAnimations, seekCssAnimations, settleAnimations } from './timelineClock';

/**
 * 同一固定 CSS 构建提供已结束、未结束及无限动画。
 * @param page - Playwright 自动清理的独立页面。
 */
async function setupClockPage(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.setContent(`<style>
      @keyframes move { from { opacity: 0; } to { opacity: 1; } }
      div { animation: move 100ms linear both; }
      #ongoing { animation-duration: 500ms; }
      #infinite { animation-iteration-count: infinite; }
    </style><div id="completed"></div><div id="ongoing"></div><div id="infinite"></div>`);
}

test('CSS 采样保留起点和重置，归还控制时完成退场不得重播，无限动画继续播放', /** 在真实浏览器验证原动画生命周期。
 * @param root0 - 独立页面夹具。 */ async ({ page }) => {
  await setupClockPage(page);
  await seekCssAnimations(page, 80, true);
  await seekCssAnimations(page, 120);
  assert.deepEqual(await animationTimes(page), [40, 40, 40]);
  await seekCssAnimations(page, 160, true);
  assert.deepEqual(await animationTimes(page), [0, 0, 0]);
  await seekCssAnimations(page, 260);
  await restoreCssAnimations(page);
  assert.deepEqual(await page.evaluate(/** 读取三种原始动画的播放状态。 */ () =>
    document.getAnimations().map(/** 保留浏览器原始播放状态。
     * @param animation - 当前 CSS 动画。 */ animation => animation.playState)), ['finished', 'running', 'running']);
});

for (const fast of [false, true]) {
  test(`CSS 预热保留结束回调且不结束无限动画，fast=${fast}`, /** 两种预热方式均核对原完成语义。
 * @param root0 - 独立页面夹具。 */ async ({ page }) => {
    await setupClockPage(page);
    await settleAnimations(page, 600, fast);
    assert.deepEqual(await page.evaluate(/** 有限动画必须完成，无限动画由采样器继续控制。 */ () =>
      document.getAnimations().map(/** 读取当前 CSS 动画的完成状态。
       * @param animation - 当前动画。 */ animation => animation.playState)), ['finished', 'finished', 'paused']);
  });
}

/**
 * 读取浏览器当前 CSS 时间，不推进虚拟时钟。
 * @param page - 被采样页面。
 */
async function animationTimes(page: Page) {
  return page.evaluate(/** 按 DOM 次序读取实际动画时刻。 */ () =>
    document.getAnimations().map(/** 保留每段动画的原始时刻。
     * @param animation - 当前动画。 */ animation => animation.currentTime));
}
