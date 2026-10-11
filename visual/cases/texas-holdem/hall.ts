import type { Page } from '@playwright/test';
import { expect } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import type { TexasProxy } from './proxy';
import { events, REPLAY_PLAYER_IDS } from './replayData';
import { advance, click, freezeClock, restore, selfId, visible } from './replay';
import { HALL_STATES } from './scenarios';

type Capture = (page: Page, scenario: VisualScenario, state: string) => Promise<void>;

/**
 * 截取德州大厅、玩家列表与入座相关状态。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param proxy - 本轮独占的代理控制对象。
 * @param roomId - 接收回放消息的房间 ID。
 * @param capture - 将页面和场景状态保存为截图的回调。
 */
export async function captureHall(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  roomId: string, capture: Capture): Promise<void> {
  const self = await selfId(page);
  await freezeClock(page);
  let index = 0;
  /**
   * 推进页面动效并按当前场景标签保存指定状态的截图。
   * @param state - 用于截图文件名的场景状态。
   */
  const snapshot = async (state: typeof HALL_STATES[number]) => {
    expect(state).toBe(HALL_STATES[index++]);
    await page.clock.runFor(500);
    await capture(page, scenario, state);
  };
  await restore(page, proxy, roomId, self, 'flop', true);
  await expect(visible(page, 'auto-rebuy-button')).toBeVisible();
  await expect(visible(page, 'report-pair-play-button')).toBeVisible();
  await snapshot('hall_table');
  await click(page, 'menu-button');
  await snapshot('hall_menu');
  // 通过菜单的真实背景按钮关闭，不触发退出房间。
  const menuMask = visible(page, 'drawer-menu-item-exit')
    .locator('xpath=ancestor::*[*[@data-testid="screen-mask-touch-to-close"]][1]')
    .locator(':scope > [data-testid="screen-mask-touch-to-close"]');
  await menuMask.evaluate(node => (node as HTMLElement).click());
  await advance(page);
  await click(page, 'auto-rebuy-button');
  await expect(visible(page, 'auto-rebuy-popup')).toBeVisible();
  await snapshot('auto_rebuy');
  await click(page, 'auto-rebuy-close-button');
  await click(page, 'report-pair-play-button');
  await expect(visible(page, 'report-pair-play-reason-input')).toBeVisible();
  await expect(page.locator('[data-testid="select-player-button"]:visible')).toHaveCount(4);
  await snapshot('pair_play_report');
  await click(page, 'report-pair-play-close-button');
  await click(page, 'texas-holdem-leaderboard-button');
  await proxy.replayTexas(roomId, events([{ event: 'player_statistics', player_id: self,
    history_buy_in_amount: 1000, played_game_count: 10, settlement_net_amount: 180 }]));
  await advance(page);
  await expect(visible(page, 'personal-leader-board-record-container')).toBeVisible();
  await expect(visible(page, 'personal-leader-board-round')).toHaveText(/(?:^|\s)10$/);
  await snapshot('personal_leaderboard');
  await click(page, 'personal-leader-board-close-button');
  await proxy.replayTexas(roomId, events([{ event: 'settlement', players: [
    { player_id: REPLAY_PLAYER_IDS[0], net: 180, prize: 180, stack: 1140 },
  ] }]));
  await advance(page);
  await expect(visible(page, 'bet-next-hand-button')).toBeVisible();
  await expect(page.getByText('Pair', { exact: true }).last()).toBeVisible();
  await snapshot('prediction');
  await proxy.replayTexas(roomId, events([{ event: 'settlement_hand_prediction',
    result: { net: 10, currency_name: 'coin' } }]));
  await expect(visible(page, 'bet-next-hand-result-background')).toBeVisible();
  await snapshot('prediction_result');
  // 用新一局事件清空上局猜牌和查看公共牌状态，再恢复下一局牌桌。
  await proxy.replayTexas(roomId, events([{ event: 'new_game', game_id: 'visual-fixed-game',
    settings: { small_blind: 1, big_blind: 2, ante: 0 } }]));
  await advance(page);
  await expect(visible(page, 'bet-next-hand-button')).toBeHidden();
  await restore(page, proxy, roomId, self, 'river');
  await click(page, 'texas-holdem-operation-button-call');
  await expect(visible(page, 'level-up-title')).toContainText('6');
  await snapshot('level_up');
  await click(page, 'level-up-close-button');
  expect(index).toBe(HALL_STATES.length);
}
