import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { advance, click, closeMask, freezeClock, restore, selfId, visible } from './replay';
import { RECORD_STATES } from './scenarios';

type Capture = (page: Page, scenario: VisualScenario, state: string) => Promise<void>;

/**
 * 截取新版德州战绩的列表、详情及空态。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param proxy - 本轮独占的代理控制对象。
 * @param roomId - 接收回放消息的房间 ID。
 * @param capture - 将页面和场景状态保存为截图的回调。
 */
export async function captureNewRecords(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  roomId: string, capture: Capture): Promise<void> {
  await freezeClock(page);
  await restore(page, proxy, roomId, await selfId(page), 'river');
  let index = 0;
  /**
   * 推进页面动效并按当前场景标签保存指定状态的截图。
   * @param state - 用于截图文件名的场景状态。
   */
  const snapshot = async (state: typeof RECORD_STATES[number]) => {
    expect(state).toBe(RECORD_STATES[index++]);
    await page.clock.runFor(500);
    await capture(page, scenario, state);
  };
  await click(page, 'game-record-button');
  await expect(visible(page, 'base-review-board-container')).toBeVisible();
  await expect(visible(page, 'review-board-description-text')).toHaveText(/empty games|没有|沒有/i);
  await snapshot('empty');
  await closeMask(page, 'base-review-board-container');
  await proxy.configureNewRecords(false);
  await click(page, 'game-record-button');
  await expect(visible(page, 'review-board-action-list')).toBeVisible();
  await expect(page.locator('[data-testid^="TexasActionListV2_PlayerAction_"]:visible').first()).toBeVisible();
  await expect(visible(page, 'review-board-pot-text')).toContainText('180');
  await snapshot('actions');
  const board = visible(page, 'base-review-board-container');
  await board.getByText(/settle|结算|結算/i).last().click();
  await advance(page);
  await expect(visible(page, 'review-board-settlement-list')).toBeVisible();
  await expect(board.locator('[data-testid="GameSettlementItemTwoV2_container"]')).toHaveCount(2);
  await snapshot('settlement');
  await click(page, 'review-board-close-button');
  expect(index).toBe(RECORD_STATES.length);
}
