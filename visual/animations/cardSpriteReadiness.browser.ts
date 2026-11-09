/** 在真实浏览器中验证图集等待不会推进动画，也不会把持续回退的牌面判为就绪。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { waitForTexasCardSprites } from './cardSpriteReadiness';

test('图片解码与布局提交后才开始采样，持续回退仍须失败', /** 验证图片解码与布局提交后才开始采样，持续回退仍须失败。 */ async () => {
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
    await page.evaluate(/** 分别控制图片下载、解码和布局提交，构造真实的牌面就绪测试。 */ () => {
      const container = document.querySelector<HTMLElement>('[data-testid="sprite-image-container"]')!;
      const image = container.querySelector('img')!;
      // 与图片组件相同，下载、解码和布局提交分开完成，不能只检查页面图片的 complete。
      const loader = new Image();
      /** 真实图片解码后等待布局，再由本页自己的回调切换显示状态。 */
      loader.onload = /** 图片加载后等待解码与布局观测，再延迟提交精灵内容。 */ async () => {
        await loader.decode();
        const observer = new ResizeObserver(/** 首次布局观测后停止监听，并安排图片内容提交。 */ () => {
          observer.disconnect();
          setTimeout(/** 隐藏后备图并显示解码后的精灵内容。 */ () => {
            container.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'none';
            container.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '1';
          }, 0);
        });
        observer.observe(container);
      };
      loader.src = image.src;
      const state = window as typeof window & { animationTicks: number };
      state.animationTicks = 0;
      setInterval(/** 累计动画周期次数，验证等待图片不会停止独立动画。 */ () => { state.animationTicks += 1; }, 16);
    });
    const before = await page.evaluate(/** 记录就绪检查前的墙钟与单调时钟值。 */ () => ({ time: Date.now(), ticks: performance.now() }));
    await waitForTexasCardSprites(page, '[data-testid="community_card"]');
    assert.deepEqual(await page.evaluate(/** 读取就绪检查后的两个时钟，验证等待没有推进动画时间。 */ () => ({ time: Date.now(), ticks: performance.now() })), before,
      '图片准备期间必须保持同一动画时刻');
    assert.equal(await page.evaluate(/** 读取动画回调计数，核对就绪等待没有触发额外动画帧。 */ () => (window as typeof window & { animationTicks: number }).animationTicks), 0,
      '图片准备不得执行下一动画帧');
    await page.evaluate(/** 隐藏精灵内容并恢复后备图，构造未就绪牌面。 */ () => {
      document.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]')!.style.display = 'flex';
      document.querySelector<HTMLElement>('[data-testid="sprite-image-content"]')!.style.opacity = '0';
    });
    await assert.rejects(waitForTexasCardSprites(page, '[data-testid="community_card"]'),
      /德州可见牌面应显示完整图集/, '已下载的图片仍在回退时，不能伪造就绪');
    assert.equal(await page.locator('[data-testid="sprite-image-fallback"]').evaluate(/** 读取目标样式，核对牌面就绪检查没有改变显示状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => getComputedStyle(node).display),
      'flex', '就绪检查不得改写应用回退层');
  } finally { await browser.close(); }
});
