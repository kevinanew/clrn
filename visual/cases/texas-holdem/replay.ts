import type { Page } from '@playwright/test';
import { expect } from './proxy';
import type { TexasProxy } from './proxy';
import { restoreTable, type Street } from './replayData';

export const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).last();
export const advance = (page: Page) => page.clock.runFor(1200);

export async function freezeClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  // CDP 在繁忙的 Linux runner 上可能排队数秒，给暂停命令保留足够提前量。
  // pauseAt 跳过期间仅触发一次到期计时器；随后恢复消息重设牌局倒计时。
  await page.clock.pauseAt(now + 60_000);
}

export async function click(page: Page, id: string): Promise<void> {
  await visible(page, id).click();
  await advance(page);
}

export async function closeMask(page: Page, marker?: string): Promise<void> {
  const mask = marker ? visible(page, marker)
    .locator('xpath=ancestor::*[*[@data-testid="screen-mask-touch-to-close"]][1]')
    .locator(':scope > [data-testid="screen-mask-touch-to-close"]')
    : visible(page, 'screen-mask-touch-to-close');
  await mask.evaluate(node => (node as HTMLElement).click());
  await advance(page);
}

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

export function selfId(page: Page): Promise<string> {
  return page.evaluate(() => JSON.parse(
    localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
}
