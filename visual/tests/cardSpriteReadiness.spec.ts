import { expect, test } from '../src/support/diagnosticTest';
import { waitForTexasCardSprites } from '../animations/cardSpriteReadiness';

test('德州隐藏牌面等待图片与牌槽，正面可见后再等待图集布局和文字回退', /** 验证德州隐藏牌面等待图片与牌槽，正面可见后再等待图集布局和文字回退。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await page.setContent(`<div data-testid="community_card" style="width:40px;height:60px">
    <div data-testid="card-flip-side-b" style="opacity:0">
      <div data-testid="sprite-image-container" style="width:0;height:0">
        <div data-testid="sprite-image-fallback" style="display:flex">A♠</div>
        <div data-testid="sprite-image-content" style="opacity:0">
          <div data-testid="sprite-image-clipper" style="transform:scale(0,0)">
            <div data-testid="sprite-image-view"><img alt="牌面"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div data-testid="player_card" style="width:40px;height:60px">
    <div data-testid="sprite-image-container">尚未翻开的手牌</div>
  </div>`);
  await page.clock.pauseAt(Date.now());

  let finished = false;
  const waiting = waitForTexasCardSprites(page, '[data-testid="community_card"]')
    .then(/** 标记牌面图片首次就绪等待已完成。 */ () => { finished = true; });
  await new Promise(/** 短暂等待并确认仅挂载图片还不足以完成牌面就绪检查。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => setTimeout(resolve, 100));
  expect(finished).toBe(false);

  await page.locator('[data-testid="sprite-image-view"] img').evaluate(/** 替换牌面图片来源，触发实际图片加载。
 * @param element - 当前匹配的页面元素。
 * @param source - 当前操作使用的 source。 */ (element, source) => {
    (element as HTMLImageElement).src = source;
  }, image);
  await expect(page.locator('[data-testid="sprite-image-view"] img')).toHaveJSProperty('naturalWidth', 1);
  await new Promise(/** 等待图片下载阶段完成后检查布局仍需提交。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => setTimeout(resolve, 100));
  expect(finished).toBe(false);

  await page.locator('[data-testid="community_card"] [data-testid="sprite-image-container"]').evaluate(/** 设置牌面精灵容器尺寸，完成可观测的布局提交。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    (node as HTMLElement).style.width = '40px';
    (node as HTMLElement).style.height = '60px';
  });
  await waiting;
  expect(finished).toBe(true);

  await page.locator('[data-testid="card-flip-side-b"]').evaluate(/** 将牌面正面设为接近侧面的可见状态，验证翻转途中不能截图。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    (node as HTMLElement).style.opacity = '1';
    (node as HTMLElement).style.transform = 'scaleX(0.05)';
  });
  // 正面虽已不透明，牌仍几乎侧立；此时可见宽度不足，文字回退尚未退场。
  await waitForTexasCardSprites(page, '[data-testid="community_card"]');
  await page.locator('[data-testid="card-flip-side-b"]').evaluate(/** 恢复正面的完整水平缩放，模拟翻牌动画完成。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    (node as HTMLElement).style.transform = 'scaleX(1)';
  });
  let visibleFinished = false;
  const visibleWaiting = waitForTexasCardSprites(page, '[data-testid="community_card"]')
    .then(/** 标记可见牌面完成全部就绪条件。 */ () => { visibleFinished = true; });
  await new Promise(/** 留出等待时间，检查仍有裁切缩放时不会提前就绪。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => setTimeout(resolve, 100));
  expect(visibleFinished).toBe(false);
  await page.locator('[data-testid="sprite-image-clipper"]').evaluate(/** 恢复精灵裁切层的正常缩放比例。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    (node as HTMLElement).style.transform = 'scale(1,1)';
  });
  await new Promise(/** 等待一次检查周期，确认后备图仍会阻止就绪。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => setTimeout(resolve, 100));
  expect(visibleFinished).toBe(false);
  await page.locator('[data-testid="sprite-image-fallback"]').evaluate(/** 隐藏牌面后备图，完成资源切换的一部分。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    (node as HTMLElement).style.display = 'none';
  });
  await page.locator('[data-testid="sprite-image-content"]').evaluate(/** 显示精灵内容，完成最终牌面渲染提交。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    (node as HTMLElement).style.opacity = '1';
  });
  await visibleWaiting;
});
