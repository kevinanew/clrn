import { expect, type TestInfo } from '@playwright/test';
import type { TexasProxy } from '../cases/texas-holdem/proxy';
import { events, REPLAY_PLAYER_IDS, restoreTable } from '../cases/texas-holdem/replayData';
import { restore } from '../cases/texas-holdem/replay';
import { visible, press } from './appSession';
import { captureTimeline, freeze } from './timeline';
import { exerciseTablePopup as exercisePopup } from './popups';
import { closeTableMask } from './tablePanels';
import type { TableSession } from './tableSession';

/**
 * 按真实消息协议采样德州牌张、玩家状态、结算和互动效果。
 * @param session - 本轮真实房间及浏览器。
 * @param proxy - 仅隔离本轮房间的代理。
 * @param info - 关键帧与时间线报告。
 */
export async function texasGameplay(session: TableSession, proxy: TexasProxy, info: TestInfo): Promise<void> {
  const { page, roomId, self, clip } = session;
  const opponent = REPLAY_PLAYER_IDS[0];
  const opponentPlayer = page.locator(`[data-testid^="texas-holdem-player-container-${opponent}"]:visible`).last();
  await freeze(page);
  await restore(page, proxy, roomId, self, 'preflop');
  const table = page.getByTestId('run-game-view');
  for (const [street, cards] of [
    ['flop', ['ah', 'kd', '7c']], ['turn', ['ah', 'kd', '7c', '2s']],
    ['river', ['ah', 'kd', '7c', '2s', 'qs']],
  ] as const) {
    await proxy.replayTexas(roomId, events([{ event: 'start_street', street, community_card: cards }]));
    await captureTimeline(page, info, `texas-${street}`, page.getByTestId('community_card_name_text'), { clip });
    // 恢复后转入实时发牌，辅助文本仍保留恢复值；断言真正渲染的牌面数量。
    await expect(page.locator('[data-testid="community_card"] [data-testid="sprite-image-content"]')).toHaveCount(cards.length);
  }
  // 实时 switch_player 使用牌局 operating_seconds，而不是消息中的 remain_operating_seconds。
  await proxy.replayTexas(roomId, events(restoreTable(self, 'river').queue.map(item =>
    item.event === 'room_status' || item.event === 'game_status'
      ? { ...item, status: { ...(item.status as Record<string, unknown>), operating_seconds: 12 } } : item)));
  await expect.poll(async () => {
    await page.clock.runFor(16);
    return page.getByTestId(`texas-holdem-player-container-${self}-operating`)
      .getByTestId('texas-holdem-active-countdown').allTextContents();
  }).toEqual(['120']);
  await expect(page.getByTestId('countdown-text')).toHaveAttribute('data-seconds', '3600');
  await page.clock.runFor(3200);
  await proxy.replayTexas(roomId, events([{ event: 'switch_player', player_id: opponent,
    valid_bets: { call: { amount: 20 } } }]));
  const countdown = page.getByTestId(`texas-holdem-player-container-${opponent}-operating`);
  await expect(countdown.getByTestId('texas-holdem-active-countdown')).toHaveText('12');
  await captureTimeline(page, info, 'texas-countdown-operation-switch', countdown,
    { clip, times: [0, 160, 1000, 4000, 8000, 10_000] });
  await expect(countdown.getByTestId('texas-holdem-active-countdown')).toHaveText('2');
  for (const action of ['call', 'raise', 'check', 'fold'] as const) {
    // 每个独立动作从真实的“轮到该玩家”消息开始，避免复用上个动作的已完成动画节点。
    await proxy.replayTexas(roomId, events([{ event: 'switch_player', player_id: opponent, remain_operating_seconds: 12 }]));
    await expect.poll(async () => {
      await page.clock.runFor(16);
      const previousAction = opponentPlayer.locator('[data-testid^="texas-holdem-player-action-"]');
      return await countdown.count() === 1 && await previousAction.count() === 0;
    }, { message: '等待异步倒计时初始化真正清除上一个动作' }).toBe(true);
    await proxy.replayTexas(roomId, events([{ event: action, player_id: opponent, amount: 40, stack: 920 }]));
    const actionLabel = opponentPlayer.getByTestId(`texas-holdem-player-action-${action}`);
    await expect(actionLabel).toBeAttached();
    await captureTimeline(page, info, `texas-${action}`, actionLabel, { clip, requireMotion: true });
  }
  await restore(page, proxy, roomId, self, 'river');
  await exercisePopup(page, info, { name: 'texas-raise', target: page.getByTestId('raise-bet-popup'), clip,
    open: /** 点击真实入口。 */ () => press(page, 'texas-holdem-operation-button-raise'),
    close: /** 通过实际按钮或遮罩关闭。 */ () => press(page, 'raise-bet-cancel-button'), exitAnimated: false });
  await exercisePopup(page, info, { name: 'texas-accurate-raise', target: page.getByTestId('accurate-bet-popup-container'), clip,
    open: /** 点击真实入口。 */ () => press(page, 'texas-holdem-operation-accurate-bet-button'),
    close: /** 通过实际按钮或遮罩关闭。 */ () => closeTableMask(page, 'accurate-bet-popup-container') });
  await freeze(page);
  await proxy.replayTexas(roomId, events([{ event: 'all_in', player_id: opponent, amount: 960, stack: 0 },
    { event: 'all_in_show_hole_card', players: [{ player_id: opponent, hole_card: ['kh', 'ks'] }] }]));
  await expect(opponentPlayer.getByTestId('texas-holdem-player-action-all_in')).toBeAttached();
  await captureTimeline(page, info, 'texas-all-in', visible(page, `texas-holdem-player-container-${opponent}`),
    { clip, mask: [page.locator('img[src*=".webp"]')], times: [0, 80, 160, 320, 640, 1200, 2400, 3200] });
  await proxy.replayTexas(roomId, events([{ event: 'showdown', players: [
    { player_id: self, hole_card: ['as', 'ad'], best_cards: ['as', 'ad', 'ah', 'kd', 'qs'],
      hand_strength: 'three_of_a_kind', strength_cards: ['as', 'ad', 'ah'], is_max_strength: true },
    { player_id: opponent, hole_card: ['kh', 'ks'], hand_strength: 'three_of_a_kind',
      strength_cards: ['kh', 'ks', 'kd'], is_max_strength: false },
  ] }]));
  await captureTimeline(page, info, 'texas-showdown', table, { clip });
  await proxy.replayTexas(roomId, events([{ event: 'settlement', players: [
    { player_id: self, net: 180, prize: 180, stack: 1180 },
    { player_id: opponent, net: -960, prize: 0, stack: 0 },
  ] }]));
  await captureTimeline(page, info, 'texas-settlement', table, { clip, times: [0, 160, 320, 800, 1600, 2800] });
  await expect(page.locator(`[data-testid^="texas-holdem-player-container-${self}"]:visible`)).toContainText('1180');

  await restore(page, proxy, roomId, self, 'flop');
  await exercisePopup(page, info, { name: 'texas-player-profile', target: page.getByTestId('player-profile-popup-close'), clip,
    // 手机首帧弹层位于上半屏；下方操作按钮尚未被弹层遮住，不属于此动画的比较区域。
    firstFrameClip: info.project.name === 'mobile' ? { ...clip, height: 500 } : undefined,
    open: /** 点击真实入口。 */ () => press(page, `texas-holdem-player-container-${opponent}`),
    close: /** 通过实际按钮或遮罩关闭。 */ () => press(page, 'player-profile-popup-close') });
  await freeze(page);
  await proxy.replayTexas(roomId, restoreTable(self, 'river'));
  await page.clock.runFor(3200);
  await press(page, 'texas-holdem-operation-button-call');
  await expect.poll(async () => {
    await page.clock.runFor(16);
    return page.getByTestId('level-up-title').textContent();
  }).toContain('6');
  await captureTimeline(page, info, 'texas-experience-level-up', page.getByTestId('level-up-title'),
    { clip, times: [0, 80, 160, 320, 1000, 4800, 5200, 5600] });
  await expect(page.getByTestId('level-up-title')).not.toBeInViewport();
}
