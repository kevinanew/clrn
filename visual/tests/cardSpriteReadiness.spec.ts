import { expect, test } from '@playwright/test';
import { waitForTexasCardSprites } from '../animations/cardSpriteReadiness';

test('德州隐藏牌面等待图片与牌槽，正面可见后再等待图集布局和文字回退', async ({ page }) => {
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
    .then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(finished).toBe(false);

  await page.locator('[data-testid="sprite-image-view"] img').evaluate((element, source) => {
    (element as HTMLImageElement).src = source;
  }, image);
  await expect(page.locator('[data-testid="sprite-image-view"] img')).toHaveJSProperty('naturalWidth', 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(finished).toBe(false);

  await page.locator('[data-testid="community_card"] [data-testid="sprite-image-container"]').evaluate(node => {
    (node as HTMLElement).style.width = '40px';
    (node as HTMLElement).style.height = '60px';
  });
  await waiting;
  expect(finished).toBe(true);

  await page.locator('[data-testid="card-flip-side-b"]').evaluate(node => {
    (node as HTMLElement).style.opacity = '1';
  });
  let visibleFinished = false;
  const visibleWaiting = waitForTexasCardSprites(page, '[data-testid="community_card"]')
    .then(() => { visibleFinished = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(visibleFinished).toBe(false);
  await page.locator('[data-testid="sprite-image-clipper"]').evaluate(node => {
    (node as HTMLElement).style.transform = 'scale(1,1)';
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(visibleFinished).toBe(false);
  await page.locator('[data-testid="sprite-image-fallback"]').evaluate(node => {
    (node as HTMLElement).style.display = 'none';
  });
  await page.locator('[data-testid="sprite-image-content"]').evaluate(node => {
    (node as HTMLElement).style.opacity = '1';
  });
  await visibleWaiting;
});
