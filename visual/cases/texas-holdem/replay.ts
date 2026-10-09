import type { Page } from '@playwright/test';
import { expect } from './proxy';
import type { TexasProxy } from './proxy';
import { restoreTable, type Street } from './replayData';

/**
 * 定位当前页面可见的测试元素，排除导航历史中的隐藏副本。
 * @param page - 执行操作的 Playwright 页面。
 * @param id - 目标控件的测试标记。
 */
export const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).last();
/**
 * 推进虚拟时钟，让回放队列和页面动效完成。
 * @param page - 执行操作的 Playwright 页面。
 */
export const advance = (page: Page) => page.clock.runFor(1200);

/**
 * 冻结游戏时钟，预留 CDP 排队时间避免暂停命令落后于当前时间。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function freezeClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  // CDP 在繁忙的 Linux runner 上可能排队数秒，给暂停命令保留足够提前量。
  // pauseAt 跳过期间仅触发一次到期计时器；随后恢复消息重设牌局倒计时。
  await page.clock.pauseAt(now + 60_000);
}

/**
 * 点击当前页面可见的测试元素。
 * @param page - 执行操作的 Playwright 页面。
 * @param id - 目标控件的测试标记。
 */
export async function click(page: Page, id: string): Promise<void> {
  await visible(page, id).click();
  await advance(page);
}

/**
 * 关闭指定弹层的遮罩，避免点击到页面历史中其他遮罩。
 * @param page - 执行操作的 Playwright 页面。
 * @param marker - 用于定位所属弹层的测试标记。
 */
export async function closeMask(page: Page, marker?: string): Promise<void> {
  const mask = marker ? visible(page, marker)
    .locator('xpath=ancestor::*[*[@data-testid="screen-mask-touch-to-close"]][1]')
    .locator(':scope > [data-testid="screen-mask-touch-to-close"]')
    : visible(page, 'screen-mask-touch-to-close');
  await mask.evaluate(node => (node as HTMLElement).click());
  await advance(page);
}

/**
 * 发送固定牌局回放，等待房间订阅和公共牌状态恢复完成。
 * @param page - 执行操作的 Playwright 页面。
 * @param proxy - 本轮独占的代理控制对象。
 * @param roomId - 接收回放消息的房间 ID。
 * @param self - 本轮登录玩家的用户 ID。
 * @param street - 牌局回合：翻牌前、翻牌、转牌或河牌。
 * @param opponent - 是否轮到对手操作。
 */
export async function restore(page: Page, proxy: TexasProxy, roomId: string, self: string,
  street: Street, opponent = false): Promise<void> {
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return proxy.replayTexas(roomId, restoreTable(self, street, opponent))
      .then(() => true, () => false);
  }, { timeout: 30_000, message: '德州房间应完成 WebSocket 订阅并接受回放' }).toBe(true);
  // 恢复消息经过队列、翻牌与数字动效；先推进固定时间再断言完成状态。
  await page.clock.runFor(3000);
  const expectedCards = ['ah', 'kd', '7c', '2s', 'qs'].map((card, position) =>
    position < { preflop: 0, flop: 3, turn: 4, river: 5 }[street] ? card : 'back');
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return page.locator('[data-testid="community_card_name_text"]').allTextContents();
  }, { timeout: 30_000, intervals: [100, 250, 500] }).toEqual(expectedCards);
  await expect(page.locator('[data-testid^="texas-holdem-player-container-"]:visible')).toHaveCount(5);
  await expect(visible(page, 'texas-holdem-self-seated-marker')).toBeVisible();
  if (!opponent) {
    await expect.poll(async () => {
      await page.clock.runFor(250);
      return visible(page, 'texas-holdem-operation-button-raise').isVisible();
    }, { timeout: 30_000, intervals: [100, 250, 500] }).toBe(true);
  }
}

/**
 * 从当前页面的持久化认证缓存读取登录用户 ID。
 * @param page - 执行操作的 Playwright 页面。
 */
export function selfId(page: Page): Promise<string> {
  return page.evaluate(() => JSON.parse(
    localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
}
