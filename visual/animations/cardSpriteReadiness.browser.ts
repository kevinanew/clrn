/** 在真实浏览器中验证图集等待不会推进动画，也不会把持续回退的牌面判为就绪。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { waitForTexasCardSprites } from './cardSpriteReadiness';

test('图片解码与布局提交后才开始采样，持续回退仍须失败', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const bitmap = new PNG({ width: 85, height: 124 });
    bitmap.data.fill(255);
    const source = `data:image/png;base64,${PNG.sync.write(bitmap).toString('base64')}`;
    await page.setContent(`<div data-testid="community_card" style="width:45px;height:68px">
      <div data-testid="sprite-image-container" style="width:45px;height:68px">
        <div data-testid="sprite-image-fallback">文字回退</div>
        <div data-testid="sprite-image-content" style="opacity:0">
          <div data-testid="sprite-image-clipper" style="transform:scale(0.5)">
            <div data-testid="sprite-image-view"><img src="${source}"></div>
          </div>
        </div>
      </div>
    </div>`);
    await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('[data-testid="sprite-image-container"]')!;
      const image = container.querySelector('img')!;
      // 与图片组件相同，下载、解码和布局提交分开完成，不能只检查页面图片的 complete。
      const loader = new Image();
      /** 真实图片解码后等待布局，再由本页自己的回调切换显示状态。 */
      loader.onload = async () => {
        await loader.decode();
        const observer = new ResizeObserver(() => {
          observer.disconnect();
          setTimeout(() => {
            container.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'none';
            container.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '1';
          }, 0);
        });
        observer.observe(container);
      };
      loader.src = image.src;
      const state = window as typeof window & { animationTicks: number };
      state.animationTicks = 0;
      setInterval(() => { state.animationTicks += 1; }, 16);
    });
    const before = await page.evaluate(() => ({ time: Date.now(), ticks: performance.now() }));
    await waitForTexasCardSprites(page, '[data-testid="community_card"]');
    assert.deepEqual(await page.evaluate(() => ({ time: Date.now(), ticks: performance.now() })), before,
      '图片准备期间必须保持同一动画时刻');
    assert.equal(await page.evaluate(() => (window as typeof window & { animationTicks: number }).animationTicks), 0,
      '图片准备不得执行下一动画帧');
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'flex';
      document.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '0';
    });
    await assert.rejects(waitForTexasCardSprites(page, '[data-testid="community_card"]'),
      /德州可见牌面应显示完整图集/, '已下载的图片仍在回退时，不能伪造就绪');
    assert.equal(await page.locator('[data-testid="sprite-image-fallback"]').evaluate(node => getComputedStyle(node).display),
      'flex', '就绪检查不得改写应用回退层');
  } finally { await browser.close(); }
});
