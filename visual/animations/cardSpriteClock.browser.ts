import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { useNormalCardSpriteClock, advanceCardSpriteClock } from './cardSpriteClock';
import { waitForTexasCardSprites } from './cardSpriteReadiness';
import { installCardSpriteDiagnostics, observeCardSpriteClockControl } from './cardSpriteDiagnostics';

test('正常时钟图集等待保留原生定时器和 CSS，持续回退仍失败', async () => {
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
    await page.evaluate(() => {
      setTimeout(() => {
        document.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'none';
        document.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '1';
      }, 80);
    });
    const before = await page.evaluate(() => Date.now());
    await advanceCardSpriteClock(page, 16);
    await waitForTexasCardSprites(page, '[data-testid="community_card"]');
    assert.ok(await page.evaluate(() => Date.now()) > before);
    assert.deepEqual(await page.evaluate(() => document.getAnimations().map(animation => animation.playState)), ['running']);
    await page.locator('[data-testid="sprite-image-fallback"]').evaluate(node => { (node as HTMLElement).style.display = 'flex'; });
    await assert.rejects(waitForTexasCardSprites(page, '[data-testid="community_card"]'), /德州可见牌面应显示完整图集/);
    await observeCardSpriteClockControl(page);
    assert.equal(await page.locator('[data-testid="sprite-image-fallback"]').evaluate(node => getComputedStyle(node).display), 'flex');
  } finally { await browser.close(); }
});
