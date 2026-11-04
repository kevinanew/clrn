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
  await expect.poll(/** 重复读取`image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)`，直到满足外层等待断言。 */ () => image.evaluate(/** 在页面中读取`node.complete && node.naturalWidth > 0`，供测试判断当前界面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ (node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
    { timeout: 60_000, message: `${category}/${name} 的实际展示图片应完成加载` }).toBe(true);
  return image;
}
