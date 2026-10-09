import type { Page } from '@playwright/test';
import { expect } from './proxy';
import type { TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { events, REPLAY_PLAYER_IDS, type Street } from './replayData';
import { GAME_STATES } from './scenarios';
import { closeMask, freezeClock, restore as restoreReplay } from './replay';
import { checkFlopCardFaces, checkMobilePlayerAction } from './renderingChecks';

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).last();
type Capture = (page: Page, scenario: VisualScenario, state: string) => Promise<void>;

/** 只注入网络消息，所有弹层均由真实可见按钮打开。 */
export async function captureGameplay(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  roomId: string, capture: Capture): Promise<void> {
  const self = await page.evaluate(() => JSON.parse(
    localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
  // 连接成功后控制页面时钟；每步只推进确定时长，固定倒计时和筹码动画。
  await freezeClock(page);
  let index = 0;
  const snapshot = async (state: typeof GAME_STATES[number]) => {
    expect(state).toBe(GAME_STATES[index++]);
    await page.clock.runFor(500);
    await capture(page, scenario, state);
  };
  const restore = async (street: Street, opponent = false) => {
    await restoreReplay(page, proxy, roomId, self, street, opponent);
  };
  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    await restore(street);
    if (street === 'flop') {
      await checkFlopCardFaces(page);
      if (scenario.viewport.label === 'mobile') await checkMobilePlayerAction(page);
    }
    await snapshot(street);
  }
  await visible(page, 'texas-holdem-operation-button-raise').click();
  await expect(visible(page, 'raise-bet-popup')).toBeVisible();
  await snapshot('raise');
  await visible(page, 'raise-bet-cancel-button').click();
  await page.clock.runFor(1200);
  await visible(page, 'texas-holdem-operation-accurate-bet-button').click();
  await expect(visible(page, 'accurate-bet-popup-container')).toBeVisible();
  await snapshot('accurate_raise');
  await visible(page, 'screen-mask-touch-to-close').evaluate(node => (node as HTMLElement).click());

  await restore('river', true);
  // 恢复对手计时不会切换操作面板，需真实 switch_player 消息才能显示预选操作。
  await proxy.replayTexas(roomId, events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0],
    valid_bets: { call: { amount: 20 } } }]));
  await page.clock.runFor(1200);
  await expect(visible(page, 'texas-holdem-operation-button-raise')).toBeHidden();
  await expect(page.getByText(/看或弃|看或棄|Check\/Fold/i).last()).toBeVisible();
  await snapshot('opponent_turn');
  await proxy.replayTexas(roomId, events([
    { event: 'all_in', player_id: REPLAY_PLAYER_IDS[0], amount: 960, stack: 0 },
    { event: 'all_in_show_hole_card', players: [{ player_id: REPLAY_PLAYER_IDS[0], hole_card: ['kh', 'ks'] }] },
  ]));
  await expect(visible(page, 'texas-holdem-player-action-all_in')).toBeVisible();
  await page.clock.runFor(1500);
  await snapshot('all_in');
  await proxy.replayTexas(roomId, events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad'], best_cards: ['as', 'ad', 'ah', 'kd', 'qs'],
      hand_strength: 'three_of_a_kind', strength_cards: ['as', 'ad', 'ah'], is_max_strength: true },
    { player_id: REPLAY_PLAYER_IDS[0], hole_card: ['kh', 'ks'], best_cards: ['kh', 'ks', 'kd', 'ah', 'qs'],
      hand_strength: 'three_of_a_kind', strength_cards: ['kh', 'ks', 'kd'], is_max_strength: false },
  ] }]));
  await page.clock.runFor(1500);
  await snapshot('showdown');
  await proxy.replayTexas(roomId, events([{ event: 'settlement', players: [
    { player_id: self, net: 180, prize: 180, stack: 1180 },
    { player_id: REPLAY_PLAYER_IDS[0], net: -960, prize: 0, stack: 0 },
  ] }]));
  await expect(visible(page, `texas-holdem-player-container-${self}`)).toContainText('1180');
  await page.clock.runFor(1500);
  await snapshot('settlement');

  const openProfile = async (player: string) => {
    await visible(page, `texas-holdem-player-container-${player}`).click();
    await expect(visible(page, 'player-profile-popup-close')).toBeVisible();
    await expect(visible(page, 'PlayerStatisticComponent_List')).toBeVisible();
  };
  await openProfile(self);
  await snapshot('own_profile');
  await visible(page, 'player-profile-popup-close').click();
  await page.clock.runFor(1200);
  await openProfile(REPLAY_PLAYER_IDS[0]);
  await expect(visible(page, 'player-profile-nickname')).toHaveText('Player1');
  await snapshot('player_profile');
  await page.getByRole('tab').last().click();
  await page.clock.runFor(500);
  await expect(visible(page, 'PlayerStatisticComponent_Item_Value_0')).toHaveText('1000');
  await snapshot('player_statistics_1000');
  await visible(page, 'PlayerStatisticComponent_Item_1').click();
  await expect(visible(page, 'toastText1')).toContainText(/主动投钱|主動投錢|actively investing/);
  await snapshot('statistics_help');
  await page.clock.runFor(6000);
  // Toast 退场后仍保留 DOM，用实际视口交集判断提示已经移出画面。
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return visible(page, 'toastText1').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom <= 0 || rect.top >= innerHeight;
    });
  }, { timeout: 30_000, intervals: [100, 250, 500] }).toBe(true);
  await visible(page, 'player-profile-report-button').click();
  await expect(visible(page, 'report-field-input')).toBeVisible();
  await snapshot('report');
  await closeMask(page, 'report-field-input');
  await expect(visible(page, 'report-field-input')).toBeHidden();
  await openProfile(REPLAY_PLAYER_IDS[0]);
  await visible(page, 'player-profile-block-button').click();
  await expect(visible(page, 'player-profile-block-button')).toHaveText(/取消屏蔽|Unblock/);
  await snapshot('block');
  await visible(page, 'player-profile-popup-close').click();
  expect(index).toBe(GAME_STATES.length);
  expect((await proxy.status()).replayedMessages).toBeGreaterThan(0);
}
