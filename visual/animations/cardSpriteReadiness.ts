import { expect, type Page } from '@playwright/test';

/**
 * 等待当前德州牌面完成图集加载和布局，避免把文字回退牌面当成动画关键帧。
 * @param page - 已暂停虚拟时钟的牌桌页面。
 */
export async function waitForTexasCardSprites(page: Page): Promise<void> {
  await expect.poll(async () => {
    await page.clock.runFor(0);
    return page.evaluate(() => {
      const cardSprites = document.querySelectorAll<HTMLElement>(
        '[data-testid="community_card"] [data-testid="sprite-image-container"], '
          + '[data-testid="player_card"] [data-testid="sprite-image-container"]',
      );
      return Array.from(cardSprites).flatMap((container, index) => {
        // 翻转前正面透明，但必须先备好牌面；以牌槽判断是否属于当前画面。
        const card = container.closest<HTMLElement>('[data-testid="community_card"], [data-testid="player_card"]');
        if (!card?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return [];
        const rectangle = card.getBoundingClientRect();
        if (rectangle.width === 0 || rectangle.height === 0 || rectangle.right <= 0
          || rectangle.bottom <= 0 || rectangle.left >= window.innerWidth
          || rectangle.top >= window.innerHeight) return [];
        const fallback = container.querySelector<HTMLElement>('[data-testid="sprite-image-fallback"]');
        const content = container.querySelector<HTMLElement>('[data-testid="sprite-image-content"]');
        const clipper = container.querySelector<HTMLElement>('[data-testid="sprite-image-clipper"]');
        const image = container.querySelector<HTMLImageElement>('[data-testid="sprite-image-view"] img');
        const clipperTransform = clipper ? getComputedStyle(clipper).transform : 'none';
        const transform = clipperTransform === 'none' ? null : new DOMMatrixReadOnly(clipperTransform);
        const ready = fallback && getComputedStyle(fallback).display === 'none'
          && content && Number(getComputedStyle(content).opacity) > 0.99
          && transform && Math.abs(transform.m11) > 0.001 && Math.abs(transform.m22) > 0.001
          && image && image.complete && image.naturalWidth > 0;
        return ready ? [] : [`牌面 ${index} 图集尚未完成加载或布局`];
      });
    });
  }, { message: '德州可见牌面应显示完整图集', timeout: 10_000 }).toEqual([]);
}
