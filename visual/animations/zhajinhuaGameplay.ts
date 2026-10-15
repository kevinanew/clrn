import { expect, type TestInfo } from '@playwright/test';
import type { ZhajinhuaProxy } from '../cases/zhajinhua/proxy';
import { events, PLAYER_IDS, restoreTable, validBets } from '../cases/zhajinhua/replayData';
import { visible, press } from './appSession';
import { captureTimeline, freeze } from './timeline';
import type { TableSession } from './tableSession';
import { exerciseTablePopup as exercisePopup } from './popups';
import { closeTableMask } from './tablePanels';

/**
 * 回放拼三张独立协议，覆盖看牌、下注、比牌往返、摊牌和结算。
 * @param session - 本轮真实房间及浏览器。
 * @param proxy - 拼三张独立回放代理。
 * @param info - 关键帧与时间线报告。
 */
export async function zhajinhuaGameplay(session: TableSession, proxy: ZhajinhuaProxy, info: TestInfo): Promise<void> {
  const { page, roomId, self, clip } = session;
  await freeze(page);
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return proxy.replay(roomId, restoreTable(self)).then(() => true, () => false);
  }, { timeout: 30_000, message: '拼三张房间应完成订阅并接受回放' }).toBe(true);
  await page.clock.runFor(3200);
  await expect(page.locator('[data-testid^="zhajinhua-player-container-"]:visible')).toHaveCount(5);
  await proxy.replay(roomId, events([{ event: 'new_game', game_id: 'visual-fixed-zhajinhua-game',
    settings: { boot: 1, raise_times: 10, max_round: 20, pot_limit: 2000 } }]));
  await page.clock.runFor(16);
  await proxy.replay(roomId, events([{ event: 'begin_play', table: { players: [self, ...PLAYER_IDS].map((player_id, index) => ({
    player_id, seat_number: index + 1, stack: 1000 - index * 40, position: index === 0 ? 'D' : '',
  })) } }]));
  await expect(page.getByTestId('player_card')).toHaveCount(15);
  await captureTimeline(page, info, 'zhajinhua-deal-cards', page.getByTestId('player_card'),
    { clip, times: [0, 160, 400, 800, 1200, 1800, 2400], requireMotion: true });
  await proxy.replay(roomId, restoreTable(self));
  await page.clock.runFor(3200);
  await proxy.replay(roomId, events([restoreTable(self).queue[0]]));
  await page.clock.runFor(1200);
  await expect(visible(page, 'zhajinhua-see-hand-card-button')).toBeVisible();
  await press(page, 'zhajinhua-see-hand-card-button');
  await proxy.replay(roomId, events([{ event: 'see_hole_card', player_id: self },
    { event: 'obtain_hole_card', hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind' },
    { event: 'player_bets', valid_bets: validBets(true) }]));
  await captureTimeline(page, info, 'zhajinhua-see-cards', page.getByTestId('player_card_name_text'), { clip });
  await expect(visible(page, 'player-card-strength-text')).not.toBeEmpty();
  await proxy.replay(roomId, events([{ event: 'raise', player_id: self, amount: 40, stack: 960 },
    { event: 'pot_update', pot_amount: 160 }]));
  await captureTimeline(page, info, 'zhajinhua-raise', visible(page, `zhajinhua-player-container-${self}`), { clip });
  await expect(visible(page, `zhajinhua-player-container-${self}`)).toContainText('960');
  await proxy.replay(roomId, restoreTable(self, false, true));
  await page.clock.runFor(3200);
  await exercisePopup(page, info, { name: 'zhajinhua-accurate-raise', target: page.getByTestId('accurate-bet-popup-container'), clip,
    open: /** 打开精确加注，不提交下注。 */ () => press(page, 'zhajinhua-operation-accurate-bet-button'),
    close: /** 点击精确加注所属遮罩。 */ () => closeTableMask(page, 'accurate-bet-popup-container') });
  await press(page, 'zhajinhua-operation-button-battle');
  const selectors = page.getByTestId('challenge_player_selector');
  await expect(selectors).toHaveCount(4);
  // RN Web 的 img 是透明的加载占位，实际闪烁的是绘制背景图的父元素。
  await captureTimeline(page, info, 'zhajinhua-challenge-selection', selectors.locator('img').locator('..'),
    { clip, times: [0, 160, 320, 500, 800, 1000], requireMotion: true });
  await press(page, 'zhajinhua-cancel-challenge-choosing');
  await expect(selectors).toHaveCount(0);
  await proxy.replay(roomId, events([{ event: 'challenge',
    from_player: { player_id: self, stack: 920, challenge_result: 'winner' },
    to_player: { player_id: PLAYER_IDS[0], stack: 960, challenge_result: 'loser' } }]));
  await expect(page.getByTestId('zhajinhua-compare-background')).toBeAttached();
  await captureTimeline(page, info, 'zhajinhua-challenge', page.getByTestId('zhajinhua-compare-background'),
    { clip, times: [0, 160, 500, 1000, 1600, 2200, 2600, 3200] });
  await expect(page.getByTestId('zhajinhua-compare-background')).toBeHidden();
  await proxy.replay(roomId, events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad', 'ac'], hand_strength: 'three_of_a_kind', is_winner: true },
    { player_id: PLAYER_IDS[1], hole_card: ['kh', 'ks', 'qd'], hand_strength: 'pair', is_winner: false },
  ] }]));
  await captureTimeline(page, info, 'zhajinhua-showdown', page.getByTestId('run-game-view'), { clip });
  await expect(page.locator('[data-testid="player_cards_container"]:visible')).toHaveCount(2);
  await proxy.replay(roomId, events([{ event: 'settlement', players: [
    { player_id: self, net: 120, prize: 120, stack: 1120 },
    { player_id: PLAYER_IDS[1], net: -40, prize: 0, stack: 880 },
  ] }]));
  await captureTimeline(page, info, 'zhajinhua-settlement', page.getByTestId('run-game-view'),
    { clip, times: [0, 160, 320, 800, 1600, 2800] });
  await expect(visible(page, `zhajinhua-player-container-${self}`)).toContainText('1120');
}
