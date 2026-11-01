/** 在大厅老虎机旧旋转结束后准备下一轮真实旋转，固定关键帧采样起点。 */
import type { Page } from '@playwright/test';
import { settleAnimations } from './timeline';

/**
 * 先让当前 1000ms 旋转完成，再快进触发下一轮；避免旧 RAF 与新旋转争用首帧。
 * 不跳过下一轮或推进其首帧，保留原有图标序列和后续 4000ms 重复周期。
 * @param page - 已完成页面准备且虚拟时钟已暂停的大厅页面。
 */
export async function prepareSlotBannerTimeline(page: Page): Promise<void> {
  await settleAnimations(page, 1200);
  await page.clock.fastForward(12_000);
}
