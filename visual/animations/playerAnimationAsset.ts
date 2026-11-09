import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 等待指定玩家实际展示的素材，避免命中预加载图片、其他玩家或上一个效果。
 * @param page - 时钟已暂停的牌桌页面。
 * @param playerId - 本次消息指定的效果接收者。
 * @param category - 素材类别。
 * @param name - 不含构建哈希的素材名称。
 */
export async function waitForPlayerAnimationAsset(page: Page, playerId: string,
  category: 'stickers' | 'props' | 'fire', name: string): Promise<Locator> {
  const player = page.locator(`[data-testid="texas-holdem-player-container-${playerId}"], `
    + `[data-testid="texas-holdem-player-container-${playerId}-operating"]`);
  const image = player.locator(`img[src*="/frames/image/${category}/${name}."][src$=".webp"]`);
  await expect(image, `${category}/${name} 应在目标玩家位置显示`).toBeVisible();
  await expect.poll(/** 轮询目标玩家图片，等待资源加载完成且具有有效像素。 */ () => image.evaluate(/** 检查图片完成标记与自然宽度，排除未加载或损坏资源。
 * @param node - 当前遍历的 DOM 或语法节点。 */ (node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
    { timeout: 60_000, message: `${category}/${name} 的实际展示图片应完成加载` }).toBe(true);
  return image;
}
