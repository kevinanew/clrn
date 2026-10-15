import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { events, REPLAY_PLAYER_IDS, restoreTable, type Street } from '../visual/cases/texas-holdem/replayData';
import { gameReady, gameGone, gameTap, gameNodes, gameSemanticText } from './game-controls';
import { replay, gameCardNames } from './game-replay';
import { closeGameMask } from './game-pregame';
import { dismissKeyboard } from './keyboard';
import { gameTapText, type TexasContext } from './texas-support';

/**
 * 复用网页的德州消息夹具，覆盖各街、操作、摊牌、结算和玩家资料。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param roomId - 本轮新建的房间。
 * @param self - 真实登录用户 ID。
 * @param capture - 按共享状态清单采集截图。
 */
export async function texasGameplay(device: AndroidDevice, proxy: Mitmproxy, roomId: string,
  self: string, capture: TexasContext['capture']): Promise<void> {
  /**
   * 发送共用网络事件。
   * @param data - Web 消息夹具。
   */
  const send = (data: unknown) => replay(proxy, 'texas', roomId, data);
  /**
   * 恢复牌局并验证五张公共牌位置。
   * @param street - 当前街。
   * @param opponent - 是否轮到对手。
   */
  const restore = async (street: Street, opponent = false) => {
    await send(restoreTable(self, street, opponent));
    const count = { preflop: 0, flop: 3, turn: 4, river: 5 }[street];
    await gameCardNames(device, 'community_card', 'community_card_name_text', ['ah', 'kd', '7c', '2s', 'qs']
      .map((card, index) => index < count ? card : 'back'));
    await expect.poll(async () => (await gameNodes(device))
      .some(node => node.res?.startsWith(`texas-holdem-player-container-${self}`)), { timeout: 30_000 }).toBe(true);
    if (!opponent) await gameReady(device, 'texas-holdem-operation-button-raise');
  };
  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    await restore(street);
    await capture(street);
  }
  await gameTap(device, 'texas-holdem-operation-button-raise');
  await gameReady(device, 'raise-bet-popup');
  await capture('raise');
  await gameTap(device, 'raise-bet-cancel-button');
  await gameGone(device, 'raise-bet-popup');
  await gameTap(device, 'texas-holdem-operation-accurate-bet-button');
  await gameReady(device, 'accurate-bet-popup-container');
  await capture('accurate_raise');
  await closeGameMask(device, 'accurate-bet-popup-container');
  await restore('river', true);
  await send(events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0], valid_bets: { call: { amount: 20 } } }]));
  await gameGone(device, 'texas-holdem-operation-button-raise');
  await capture('opponent_turn');
  await send(events([{ event: 'all_in', player_id: REPLAY_PLAYER_IDS[0], amount: 960, stack: 0 },
    { event: 'all_in_show_hole_card', players: [{ player_id: REPLAY_PLAYER_IDS[0], hole_card: ['kh', 'ks'] }] }]));
  await gameReady(device, 'texas-holdem-player-action-all_in');
  await capture('all_in');
  await send(events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad'], best_cards: ['as', 'ad', 'ah', 'kd', 'qs'],
      hand_strength: 'three_of_a_kind', strength_cards: ['as', 'ad', 'ah'], is_max_strength: true },
    { player_id: REPLAY_PLAYER_IDS[0], hole_card: ['kh', 'ks'], best_cards: ['kh', 'ks', 'kd', 'ah', 'qs'],
      hand_strength: 'three_of_a_kind', strength_cards: ['kh', 'ks', 'kd'], is_max_strength: false },
  ] }]));
  await capture('showdown');
  await send(events([{ event: 'settlement', players: [
    { player_id: self, net: 180, prize: 180, stack: 1180 },
    { player_id: REPLAY_PLAYER_IDS[0], net: -960, prize: 0, stack: 0 },
  ] }]));
  // 摊牌时余额被牌型标签替代；余额语义标记仍附在当前可见玩家容器内。
  await expect.poll(async () => gameSemanticText((await gameNodes(device))
    .find(node => node.res === `texas-holdem-player-container-${self}`), 'text-holdem-own-balance-text'),
  { timeout: 30_000 }).toBe('1180');
  await capture('settlement');
  /**
   * 打开玩家资料，等待统计数据实际完成加载。
   * @param player - 共享夹具玩家或本人 ID。
   */
  const profile = async (player: string) => {
    const node = (await gameNodes(device)).find(item => item.res?.startsWith(`texas-holdem-player-container-${player}`));
    expect(node).toBeDefined();
    await gameTap(device, node!.res!);
    await gameReady(device, 'player-profile-popup-close');
    await gameReady(device, 'PlayerStatisticComponent_Item_Value_0');
  };
  await profile(self);
  await capture('own_profile');
  await gameTap(device, 'player-profile-popup-close');
  await gameGone(device, 'player-profile-popup-close');
  await profile(REPLAY_PLAYER_IDS[0]);
  await gameReady(device, 'player-profile-nickname', 'Player1');
  await capture('player_profile');
  await gameTapText(device, /^(千场统计|千場統計|1000 Times Statistics)$/);
  await gameReady(device, 'PlayerStatisticComponent_Item_Value_0', '1000');
  await capture('player_statistics_1000');
  await capture('statistics_help', [], () => gameTap(device, 'PlayerStatisticComponent_Item_1', true));
  await gameGone(device, 'toastText1');
  await gameTap(device, 'player-profile-report-button');
  await gameReady(device, 'report-field-input');
  await dismissKeyboard(device);
  await capture('report');
  await closeGameMask(device, 'report-field-input');
  await profile(REPLAY_PLAYER_IDS[0]);
  await gameTap(device, 'player-profile-block-button');
  await capture('block');
  await gameTap(device, 'player-profile-popup-close');
  expect((await proxy.command<{ replayedMessages: number }>('status')).replayedMessages).toBeGreaterThan(0);
}
