import type { Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';
import { expect, type ZhajinhuaProxy } from './proxy';
import { advance, capture, click as clickUi, closeMask, visible } from './capture';
import { events, PLAYER_IDS, restoreTable, validBets } from './replayData';
import { GAME_STATES } from './scenarios';

async function click(page: Page, id: string): Promise<void> {
  await clickUi(page, id);
  await advance(page);
}

export async function captureGameplay(page: Page, scenario: VisualScenario,
  proxy: ZhajinhuaProxy, roomId: string): Promise<void> {
  const self = await page.evaluate(() => JSON.parse(
    localStorage.getItem('save.user.origin.data.from.server.key') || '{}').user_id as string);
  let index = 0;
  const snapshot = async (state: typeof GAME_STATES[number]) => {
    expect(state).toBe(GAME_STATES[index++]);
    await capture(page, scenario, state);
  };
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return proxy.replay(roomId, restoreTable(self)).then(() => true, () => false);
  }, { timeout: 30_000, message: '拼三张本次新建房间应接受回放' }).toBe(true);
  await page.clock.runFor(3000);
  await expect(page.locator('[data-testid^="zhajinhua-player-container-"]:visible')).toHaveCount(5);
  await expect(visible(page, 'zhajinhua-operation-button-call')).toBeVisible();
  await expect(visible(page, 'zhajinhua-see-hand-card-button')).toBeVisible();
  await snapshot('blind_cards');

  await click(page, 'zhajinhua-see-hand-card-button');
  await proxy.replay(roomId, events([
    { event: 'see_hole_card', player_id: self },
    { event: 'obtain_hole_card', hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind' },
    { event: 'player_bets', valid_bets: validBets(true) },
  ]));
  await page.clock.runFor(1500);
  await expect(visible(page, 'player-card-strength-text')).not.toBeEmpty();
  await expect(page.locator('[data-testid="player_card_name_text"]:visible')
    .filter({ hasText: /^(as|ad|ac)$/ })).toHaveText(['as', 'ad', 'ac']);
  await expect(visible(page, 'zhajinhua-see-hand-card-button')).toBeHidden();
  await snapshot('seen_cards');
  await click(page, 'zhajinhua-shortcut-raise-first');
  await proxy.replay(roomId, events([
    { event: 'raise', player_id: self, amount: 40, stack: 960 },
    { event: 'pot_update', pot_amount: 160 },
  ]));
  await advance(page);
  await expect(visible(page, `zhajinhua-player-container-${self}`)).toContainText('960');
  await snapshot('quick_raise');
  await proxy.replay(roomId, restoreTable(self, false, true));
  await page.clock.runFor(3000);
  await click(page, 'zhajinhua-operation-accurate-bet-button');
  await expect(visible(page, 'accurate-bet-popup-container')).toBeVisible();
  await snapshot('accurate_raise');
  await closeMask(page, 'accurate-bet-popup-container', true);
  await click(page, 'zhajinhua-operation-button-battle');
  await expect(page.locator('[data-testid="challenge_player_selector"]:visible')).toHaveCount(4);
  await snapshot('challenge_select');
  await click(page, 'zhajinhua-cancel-challenge-choosing');

  // 提交快捷加注隐藏本人的操作区，再恢复对手操作状态。
  await click(page, 'zhajinhua-shortcut-raise-first');
  await proxy.replay(roomId, restoreTable(self, true, true));
  await page.clock.runFor(3000);
  await expect(visible(page, `zhajinhua-player-container-${PLAYER_IDS[0]}-operating`)).toBeVisible();
  await expect(visible(page, 'zhajinhua-operation-button-call')).toBeHidden();
  await snapshot('opponent_turn');
  await proxy.replay(roomId, events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind', is_winner: true },
    { player_id: PLAYER_IDS[0], hole_card: ['kh', 'ks', 'qd'], hand_strength: 'pair', is_winner: false },
  ] }]));
  await page.clock.runFor(1500);
  await expect(page.locator('[data-testid="player_cards_container"]:visible')).toHaveCount(2);
  await snapshot('showdown');
  await proxy.replay(roomId, events([{ event: 'settlement', players: [
    { player_id: self, net: 120, prize: 120, stack: 1120 },
    { player_id: PLAYER_IDS[0], net: -40, prize: 0, stack: 920 },
  ] }]));
  await page.clock.runFor(2000);
  await expect(visible(page, `zhajinhua-player-container-${self}`)).toContainText('1120');
  await snapshot('settlement');
  expect(index).toBe(GAME_STATES.length);
  const status = await proxy.status();
  expect(status.replayedMessages).toBeGreaterThan(0);
  expect(status.blockedRpcs).toBeGreaterThan(0);
}
