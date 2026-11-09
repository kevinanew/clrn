import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { useNormalCardSpriteClock, advanceCardSpriteClock } from './cardSpriteClock';
import { waitForTexasCardSprites } from './cardSpriteReadiness';
import { installCardSpriteDiagnostics, observeCardSpriteClockControl } from './cardSpriteDiagnostics';

test('正常时钟图集等待保留原生定时器和 CSS，持续回退仍失败', /** 验证正常时钟图集等待保留原生定时器和 CSS，持续回退仍失败。 */ async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await installCardSpriteDiagnostics(page);
    useNormalCardSpriteClock(page);
    // 若正常分支误触及任何 Playwright 时钟操作，立即失败。
    /** 禁止通过虚拟推进冒充正常时间。 */
    const rejectVirtualClock = async () => { throw new Error('unexpected virtual clock'); };
    page.clock.runFor = rejectVirtualClock;
    page.clock.install = rejectVirtualClock;
    page.clock.pauseAt = rejectVirtualClock;
    page.clock.resume = rejectVirtualClock;
    page.clock.fastForward = rejectVirtualClock;
    await page.goto('about:blank');
    await page.setContent(`<style>@keyframes moving {to {transform:translateX(20px)}}</style>
      <div data-testid="community_card" style="width:45px;height:68px">
        <div data-testid="sprite-image-container" style="width:45px;height:68px">
          <div data-testid="sprite-image-fallback" style="display:flex"></div>
          <div data-testid="sprite-image-content" style="opacity:0">
            <div data-testid="sprite-image-clipper" style="transform:scale(0.5)">
              <div data-testid="sprite-image-view"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='85' height='124'/%3E"></div>
            </div>
          </div>
        </div>
      </div><div style="animation:moving 2s infinite"></div>`);
    await page.evaluate(/** 延迟切换牌面精灵内容与后备图，构造图片迟到场景。 */ () => {
      setTimeout(/** 隐藏后备图并显示精灵图片，模拟图片资源完成加载。 */ () => {
        document.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'none';
        document.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '1';
      }, 80);
    });
    const before = await page.evaluate(/** 记录牌面时钟测试开始时的冻结时间。 */ () => Date.now());
    await advanceCardSpriteClock(page, 16);
    await waitForTexasCardSprites(page, '[data-testid="community_card"]');
    assert.ok(await page.evaluate(/** 读取牌面采样后的时间，验证采样未推进页面时钟。 */ () => Date.now()) > before);
    assert.deepEqual(await page.evaluate(/** 读取页面动画播放状态，核对牌面独立时钟的冻结效果。 */ () => document.getAnimations().map(/** 读取页面各动画的播放状态，核对独立时钟冻结效果。
 * @param animation - 当前操作使用的 animation。 */ animation => animation.playState)), ['running']);
    await page.locator('[data-testid="sprite-image-fallback"]').evaluate(/** 重新显示牌面后备图，验证就绪检查能识别精灵尚未提交。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => { (node as HTMLElement).style.display = 'flex'; });
    await assert.rejects(waitForTexasCardSprites(page, '[data-testid="community_card"]'), /德州可见牌面应显示完整图集/);
    await observeCardSpriteClockControl(page);
    assert.equal(await page.locator('[data-testid="sprite-image-fallback"]').evaluate(/** 读取目标元素的 display 样式，核对牌面等待期间的可见性。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => getComputedStyle(node).display), 'flex');
  } finally { await browser.close(); }
});
