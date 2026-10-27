import { expect, test } from '@playwright/test';
import { waitForTexasCardSprites } from '../animations/cardSpriteReadiness';

test('德州翻转前的透明正面仍须完成图集布局并隐藏文字回退', async ({ page }) => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await page.setContent(`<div data-testid="community_card" style="width:40px;height:60px">
    <div data-testid="card-flip-side-b" style="opacity:0">
      <div data-testid="sprite-image-container" style="width:40px;height:60px">
        <div data-testid="sprite-image-fallback" style="display:flex">A♠</div>
        <div data-testid="sprite-image-content" style="opacity:0">
          <div data-testid="sprite-image-clipper" style="transform:scale(0,0)">
            <div data-testid="sprite-image-view"><img src="${image}" alt="牌面"></div>
          </div>
        </div>
      </div>
    </div>
  </div>`);
  await page.clock.pauseAt(Date.now());
  await expect(page.locator('img')).toHaveJSProperty('complete', true);

  let finished = false;
  const waiting = waitForTexasCardSprites(page).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(finished).toBe(false);
  await page.locator('[data-testid="sprite-image-fallback"]').evaluate(node => {
    (node as HTMLElement).style.display = 'none';
  });
  await page.locator('[data-testid="sprite-image-content"]').evaluate(node => {
    (node as HTMLElement).style.opacity = '1';
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(finished).toBe(false);
  await page.locator('[data-testid="sprite-image-clipper"]').evaluate(node => {
    (node as HTMLElement).style.transform = 'scale(1,1)';
  });
  await waiting;
});
