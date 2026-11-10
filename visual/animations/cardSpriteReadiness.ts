import { cardSpriteReadinessState, decodeCardSpriteImages } from './cardSpriteReadinessState';
import { expect, type Page } from '@playwright/test';
import { settleLayout } from './renderReadiness';
import { markCardSpriteFailure, sampleCardSprites } from './cardSpriteDiagnostics';

/**
 * 等待当前德州可见正面完成图集加载和布局，避免把文字回退牌面当成动画关键帧。
 * @param page - 已暂停虚拟时钟的牌桌页面。
 * @param scope - 本段动画实际展示牌面的容器选择器。
 */
export async function waitForTexasCardSprites(page: Page, scope: string): Promise<void> {
  await sampleCardSprites(page, 'wait-start');
  try {
    await expect.poll(/** 重复等待图片解码并采集牌槽状态，直到所有可见牌面真正就绪。 */ async () => {
      // complete 与原始尺寸只表示资源已取得；图集切换还要等待真实解码和界面提交。
      await page.evaluate(decodeCardSpriteImages, scope);
      await sampleCardSprites(page, 'before-settle-layout');
      await settleLayout(page);
      await sampleCardSprites(page, 'after-settle-layout');
      return page.evaluate(cardSpriteReadinessState, scope);
    }, { message: '德州可见牌面应显示完整图集', timeout: 10_000 }).toEqual([]);
    await sampleCardSprites(page, 'wait-ready');
  } catch (error) {
    markCardSpriteFailure(page);
    await sampleCardSprites(page, 'wait-failed').catch(/** 忽略本次可选操作的失败，让后续清理或就绪检查继续。 */ () => undefined);
    throw error;
  }
}
