import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { events, PLAYER_IDS, restoreTable, validBets } from '../visual/cases/zhajinhua/replayData';
import { gameReady, gameGone, gameTap, gameNodes, gameSemanticText } from './game-controls';
import { replay, gameCardNames } from './game-replay';
import { closeGameMask } from './game-pregame';

/**
 * 直接使用 Web 八个牌局状态的网络事件，真实点击原生操作按钮。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param roomId - 本轮创建的房间。
 * @param self - 本轮真实登录用户。
 * @param capture - 使用共用状态名采集截图。
 */
export async function zhajinhuaGameplay(device: AndroidDevice, proxy: Mitmproxy, roomId: string,
  self: string, capture: (state: string) => Promise<void>): Promise<void> {
  /**
   * 发送共用回放事件。
   * @param data - Web 共用的网络事件。
   */
  const send = (data: unknown) => replay(proxy, 'zhajinhua', roomId, data);
  await send(restoreTable(self));
  await expect.poll(async () => (await gameNodes(device))
    .filter(node => node.res?.startsWith('zhajinhua-player-container-')).length, { timeout: 30_000 }).toBe(5);
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'player_card').length,
    { timeout: 30_000 }).toBe(15);
  await send(events([restoreTable(self).queue[0]]));
  await gameGone(device, 'player_tips_text');
  await gameReady(device, 'zhajinhua-operation-button-call');
  await gameReady(device, 'zhajinhua-see-hand-card-button');
  await capture('blind_cards');
  await gameTap(device, 'zhajinhua-see-hand-card-button');
  await send(events([
    { event: 'see_hole_card', player_id: self },
    { event: 'obtain_hole_card', hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind' },
    { event: 'player_bets', valid_bets: validBets(true) },
  ]));
  // 其余四位玩家的十二张暗牌没有牌名；与 Web 相同，只校验已翻开的三张牌。
  await gameCardNames(device, 'player_card', 'player_card_name_text', ['as', 'ad', 'ac'], { namedOnly: true });
  await gameGone(device, 'zhajinhua-see-hand-card-button');
  await capture('seen_cards');
  await gameTap(device, 'zhajinhua-shortcut-raise-first');
  await send(events([{ event: 'raise', player_id: self, amount: 40, stack: 960 },
    { event: 'pot_update', pot_amount: 160 }]));
  await gameReady(device, `zhajinhua-player-container-${self}`);
  await expect.poll(async () => gameSemanticText((await gameNodes(device))
    .find(node => node.res === `zhajinhua-player-container-${self}`), 'player_stack_text'),
  { timeout: 30_000 }).toBe(`${self} 960`);
  await capture('quick_raise');
  await send(restoreTable(self, false, true));
  await gameReady(device, 'zhajinhua-operation-accurate-bet-button');
  await gameTap(device, 'zhajinhua-operation-accurate-bet-button');
  await gameReady(device, 'accurate-bet-popup-container');
  await capture('accurate_raise');
  await closeGameMask(device, 'accurate-bet-popup-container');
  await gameTap(device, 'zhajinhua-operation-button-battle');
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'challenge_player_selector').length,
    { timeout: 30_000 }).toBe(4);
  await capture('challenge_select');
  await gameTap(device, 'zhajinhua-cancel-challenge-choosing');
  await gameTap(device, 'zhajinhua-shortcut-raise-first');
  await send(restoreTable(self, true, true));
  await gameReady(device, `zhajinhua-player-container-${PLAYER_IDS[0]}-operating`);
  await gameGone(device, 'zhajinhua-operation-button-call');
  await capture('opponent_turn');
  await send(events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind', is_winner: true },
    { player_id: PLAYER_IDS[0], hole_card: ['kh', 'ks', 'qd'], hand_strength: 'pair', is_winner: false },
  ] }]));
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'player_cards_container').length,
    { timeout: 30_000 }).toBe(2);
  await capture('showdown');
  await send(events([{ event: 'settlement', players: [
    { player_id: self, net: 120, prize: 120, stack: 1120 },
    { player_id: PLAYER_IDS[0], net: -40, prize: 0, stack: 920 },
  ] }]));
  // 与德州一样，摊牌后的牌型会覆盖余额；从当前可见玩家读取明确的余额语义标记。
  await expect.poll(async () => gameSemanticText((await gameNodes(device))
    .find(node => node.res === `zhajinhua-player-container-${self}`), 'player_stack_text'),
  { timeout: 30_000 }).toBe(`${self} 1120`);
  await capture('settlement');
  const status = await proxy.command<{ replayedMessages: number; blockedRpcs: number }>('status');
  expect(status.replayedMessages).toBeGreaterThan(0);
  expect(status.blockedRpcs).toBeGreaterThan(0);
}
