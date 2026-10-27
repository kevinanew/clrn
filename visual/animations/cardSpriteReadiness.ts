import { expect, type Page } from '@playwright/test';
import { settleLayout } from './renderReadiness';

/**
 * 等待当前德州可见正面完成图集加载和布局，避免把文字回退牌面当成动画关键帧。
 * @param page - 已暂停虚拟时钟的牌桌页面。
 * @param scope - 本段动画实际展示牌面的容器选择器。
 */
export async function waitForTexasCardSprites(page: Page, scope: string): Promise<void> {
  await expect.poll(async () => {
    // complete 与原始尺寸只表示资源已取得；图集切换还要等待真实解码和界面提交。
    await page.evaluate(async selector => {
      const images = document.querySelectorAll<HTMLImageElement>(
        `${selector} [data-testid="sprite-image-view"] img`,
      );
      await Promise.all(Array.from(images).filter(image => image.complete && image.naturalWidth > 0)
        .map(image => image.decode()));
    }, scope);
    await settleLayout(page);
    return page.evaluate(selector => {
      const cardSprites = document.querySelectorAll<HTMLElement>(
        `${selector} [data-testid="sprite-image-container"]`,
      );
      if (cardSprites.length === 0) return ['目标牌面图集尚未挂载'];
      return Array.from(cardSprites).flatMap((container, index) => {
        // 翻转前正面透明，但必须先备好牌面；以牌槽判断是否属于当前画面。
        const card = container.closest<HTMLElement>(selector);
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
        const frontVisible = container.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        const flip = container.closest<HTMLElement>('[data-testid="card-flip"]');
        const faceSide = container.closest<HTMLElement>('[data-testid="card-flip-side-b"]');
        const faceOpacity = faceSide ? Number(getComputedStyle(faceSide).opacity) : null;
        const containerBox = container.getBoundingClientRect();
        // side 在翻转开始时更新，正面仍要等到过半程才显示；以实际正面层透明度判断。
        const frontFacing = frontVisible && (!flip || (faceSide !== null && faceOpacity !== null && faceOpacity > 0.99))
          && container.offsetWidth > 0
          && containerBox.width >= container.offsetWidth * 0.5;
        // 盖牌阶段仍须确认资源加载及牌槽尺寸；裁切布局只在正面露出后才可能完成。
        const resourceReady = image?.complete && image.naturalWidth > 0
          && containerBox.width > 0 && containerBox.height > 0;
        const ready = resourceReady && (!frontFacing || (transform && Math.abs(transform.m11) > 0.001
          && Math.abs(transform.m22) > 0.001 && fallback && getComputedStyle(fallback).display === 'none'
          && content && Number(getComputedStyle(content).opacity) > 0.99));
        if (ready) return [];
        return [`牌面 ${index} 图集未就绪：翻牌侧=${flip?.getAttribute('data-side') ?? '无'}；正面层透明度=${faceOpacity ?? '无'}；正面可见=${frontVisible}；正面朝向观众=${frontFacing}；回退显示=${fallback ? getComputedStyle(fallback).display : '缺失'}；`
          + `内容透明度=${content ? getComputedStyle(content).opacity : '缺失'}；`
          + `裁切变换=${clipperTransform}；图片加载=${image?.complete ?? '缺失'}；`
          + `图片原宽=${image?.naturalWidth ?? '缺失'}；牌面宽高=${containerBox.width}×${containerBox.height}；`
          + `牌面原宽=${container.offsetWidth}`];
      });
    }, scope);
  }, { message: '德州可见牌面应显示完整图集', timeout: 10_000 }).toEqual([]);
}
