import { expect, type TestInfo } from '@playwright/test';
import type { TexasProxy } from '../cases/texas-holdem/proxy';
import { REPLAY_PLAYER_IDS, restoreTable } from '../cases/texas-holdem/replayData';
import { restore } from '../cases/texas-holdem/replay';
import { visible, press } from './appSession';
import { captureTimeline, freeze } from './timeline';
import { exerciseTablePopup as exercisePopup } from './popups';
import { closeTableMask } from './tablePanels';
import { waitForTexasCardSprites } from './cardSpriteReadiness';
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
    await proxy.replayTexas(roomId, { scene: 'texas-gameplay-start_street', parameters: { street: street } });
    // 每张公共牌先异步读取牌面样式；全部牌面挂载后再由采样器启动首个翻转计时器。
    await expect(page.locator('[data-testid="community_card"] [data-testid="sprite-image-content"]'))
      .toHaveCount(cards.length);
    await waitForTexasCardSprites(page, '[data-testid="community_card"]');
    if (street === 'flop') {
      // 等待首张牌的零延迟翻转真正开始，再以该时刻采样公共牌移动。
      const firstFlip = page.locator('[data-testid="community_card"]:visible').first().getByTestId('card-flip');
      await expect.poll(async () => {
        await page.clock.runFor(0);
        return firstFlip.getAttribute('data-side');
      }, { message: '首张公共牌应开始翻转' }).toBe('1');
    }
    await captureTimeline(page, info, `texas-${street}`, page.getByTestId('community_card_name_text'),
      { clip, waitForCardSprites: '[data-testid="community_card"]' });
  }
  // 实时 switch_player 使用牌局 operating_seconds，而不是消息中的 remain_operating_seconds。
  await proxy.replayTexas(roomId, { scene: 'countdown' });
  await expect.poll(async () => {
    await page.clock.runFor(16);
    return page.getByTestId(`texas-holdem-player-container-${self}-operating`)
      .getByTestId('texas-holdem-active-countdown').allTextContents();
  }).toEqual(['120']);
  await expect(page.getByTestId('countdown-text')).toHaveAttribute('data-seconds', '3600');
  await page.clock.runFor(3200);
  await proxy.replayTexas(roomId, { scene: 'texas-gameplay-switch_player' });
  const countdown = page.getByTestId(`texas-holdem-player-container-${opponent}-operating`);
  await expect(countdown.getByTestId('texas-holdem-active-countdown')).toHaveText('12');
  await captureTimeline(page, info, 'texas-countdown-operation-switch', countdown,
    { clip, times: [0, 160, 1000, 4000, 8000, 10_000] });
  await expect(countdown.getByTestId('texas-holdem-active-countdown')).toHaveText('2');
  for (const action of ['call', 'raise', 'check', 'fold'] as const) {
    // 每个独立动作从真实的“轮到该玩家”消息开始，避免复用上个动作的已完成动画节点。
    await proxy.replayTexas(roomId, { scene: 'texas-gameplay-switch_player-2' });
    await expect.poll(async () => {
      await page.clock.runFor(16);
      const previousAction = opponentPlayer.locator('[data-testid^="texas-holdem-player-action-"]');
      return await countdown.count() === 1 && await previousAction.count() === 0;
    }, { message: '等待异步倒计时初始化真正清除上一个动作' }).toBe(true);
    await proxy.replayTexas(roomId, { scene: 'texas-gameplay-@action', parameters: { action: action } });
    const actionLabel = opponentPlayer.getByTestId(`texas-holdem-player-action-${action}`);
    await expect(actionLabel).toBeAttached();
    await captureTimeline(page, info, `texas-${action}`, actionLabel, { clip, requireMotion: true });
  }
  await restore(page, proxy, roomId, self, 'river');
  await exercisePopup(page, info, { name: 'texas-raise', target: page.getByTestId('raise-bet-popup'), clip,
    open: /** 点击真实入口。 */ () => press(page, 'texas-holdem-operation-button-raise'),
    close: /** 通过实际按钮或遮罩关闭。 */ () => press(page, 'raise-bet-cancel-button'), exitAnimated: false });
  // 偶发牌桌重连会遮住真实入口；等待连接恢复后再采样下一段动画。
  /** 等待牌桌连接恢复，再点击真实的精确加注入口。 */
  const openAccurateRaise = async () => {
    const reconnecting = page.getByText('Connecting...', { exact: true });
    await expect.poll(async () => {
      if (!(await reconnecting.isVisible())) return true;
      await page.clock.runFor(250);
      return !(await reconnecting.isVisible());
    }, { message: '牌桌必须在重连完成后打开精确加注', timeout: 30_000 }).toBe(true);
    await press(page, 'texas-holdem-operation-accurate-bet-button');
  };
  await exercisePopup(page, info, { name: 'texas-accurate-raise', target: page.getByTestId('accurate-bet-popup-container'), clip,
    open: openAccurateRaise,
    close: /** 通过实际按钮或遮罩关闭。 */ () => closeTableMask(page, 'accurate-bet-popup-container') });
  await freeze(page);
  await proxy.replayTexas(roomId, { scene: 'texas-gameplay-all_in-all_in_show_hole_card' });
  await expect(opponentPlayer.getByTestId('texas-holdem-player-action-all_in')).toBeAttached();
  // 全押公开手牌由玩家组件绘制，等异步读取牌面样式后确认两张 K 牌已就绪。
  const publicCards = opponentPlayer.getByTestId('texas-holdem-player-hole-cards');
  const publicCardScope = `[data-testid^="texas-holdem-player-container-${opponent}"] `
    + '[data-testid="texas-holdem-player-hole-cards"]';
  await expect(publicCards.getByTestId('sprite-image-container')).toHaveCount(2);
  await expect(publicCards.getByTestId('poker-text-letter')).toHaveText(['k', 'k']);
  await expect(publicCards.getByTestId('poker-text-suit')).toHaveText(['♥', '♠']);
  await waitForTexasCardSprites(page, publicCardScope);
  await captureTimeline(page, info, 'texas-all-in', visible(page, `texas-holdem-player-container-${opponent}`),
    { clip, mask: [page.locator('img[src*=".webp"]')], times: [0, 80, 160, 320, 640, 1200, 2400, 3200] });
  await proxy.replayTexas(roomId, { scene: 'texas-gameplay-showdown' });
  await waitForTexasCardSprites(page, publicCardScope);
  // 摊牌同时替换本人手牌；两侧图集都就绪后再比较固定时刻的真实画面。
  await waitForTexasCardSprites(page, '[data-testid="texas-holdem-player-hole-cards"]');
  await captureTimeline(page, info, 'texas-showdown', table, { clip });
  await proxy.replayTexas(roomId, { scene: 'texas-gameplay-settlement' });
  await captureTimeline(page, info, 'texas-settlement', table, { clip, times: [0, 160, 320, 800, 1600, 2800] });
  await expect(page.locator(`[data-testid^="texas-holdem-player-container-${self}"]:visible`)).toContainText('1180');

  await restore(page, proxy, roomId, self, 'flop');
  await exercisePopup(page, info, { name: 'texas-player-profile', target: page.getByTestId('player-profile-popup-close'), clip,
    // 手机端下方操作按钮会独立变化；每帧仍保留资料弹层实际覆盖的全部像素。
    foregroundBelow: info.project.name === 'mobile' ? { y: 500,
      locator: page.getByTestId('player-profile-popup-close').locator('xpath=../..') } : undefined,
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
