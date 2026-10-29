import { expect, type TestInfo } from '@playwright/test';
import type { ZhajinhuaProxy } from '../cases/zhajinhua/proxy';
import { restoreTable } from '../cases/zhajinhua/replayData';
import { visible, press } from './appSession';
import { captureTimeline, freeze } from './timeline';
import type { TableSession } from './tableSession';
import { exerciseTablePopup as exercisePopup } from './popups';
import { closeTableMask } from './tablePanels';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { zhajinhuaFeedback } from './zhajinhuaFeedback';

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
  await proxy.replay(roomId, { scene: 'zhajinhua-gameplay-new_game' });
  await page.clock.runFor(16);
  await proxy.replay(roomId, { scene: 'zhajinhua-gameplay-begin_play' });
  await expect(page.getByTestId('player_card')).toHaveCount(15);
  await captureTimeline(page, info, 'zhajinhua-deal-cards', page.getByTestId('player_card'),
    { clip, times: [0, 160, 400, 800, 1200, 1800, 2400], requireMotion: true });
  await proxy.replay(roomId, restoreTable(self));
  await page.clock.runFor(3200);
  await proxy.replay(roomId, { scene: 'room-running' });
  await page.clock.runFor(1200);
  await expect(visible(page, 'zhajinhua-see-hand-card-button')).toBeVisible();
  await press(page, 'zhajinhua-see-hand-card-button');
  await proxy.replay(roomId, { scene: 'zhajinhua-gameplay-see_hole_card-obtain_hole_card-player_bets' });
  await captureTimeline(page, info, 'zhajinhua-see-cards', page.getByTestId('player_card_name_text'), { clip });
  await expect(visible(page, 'player-card-strength-text')).not.toBeEmpty();
  await proxy.replay(roomId, { scene: 'zhajinhua-gameplay-raise-pot_update' });
  await expect(visible(page, `zhajinhua-player-container-${self}`)).toContainText('Raise');
  await captureTimeline(page, info, 'zhajinhua-raise', visible(page, `zhajinhua-player-container-${self}`), { clip });
  await expect(visible(page, `zhajinhua-player-container-${self}`)).toContainText('960');
  await proxy.replay(roomId, restoreTable(self, false, true));
  await page.clock.runFor(3200);
  await exercisePopup(page, info, { name: 'zhajinhua-accurate-raise', target: page.getByTestId('accurate-bet-popup-container'), clip,
    open: /** 每次采样从相同牌局和计时起点打开精确加注，不提交下注。 */ async () => {
      await proxy.replay(roomId, restoreTable(self, false, true));
      await expect(page.getByTestId(`zhajinhua-player-container-${self}-operating`)
        .getByTestId('zhajinhua-active-countdown')).toHaveText('120');
      await expect(page.getByTestId('countdown-text')).toHaveAttribute('data-seconds', '3600');
      await page.clock.runFor(3200);
      await press(page, 'zhajinhua-operation-accurate-bet-button');
    },
    close: /** 点击精确加注所属遮罩。 */ () => closeTableMask(page, 'accurate-bet-popup-container') });
  await press(page, 'zhajinhua-operation-button-battle');
  const selectors = page.getByTestId('challenge_player_selector');
  await expect(selectors).toHaveCount(4);
  // RN Web 的 img 是透明的加载占位，实际闪烁的是绘制背景图的父元素。
  await captureTimeline(page, info, 'zhajinhua-challenge-selection', selectors.locator('img').locator('..'),
    { clip, times: [0, 160, 320, 500, 800, 1000], requireMotion: true });
  await press(page, 'zhajinhua-cancel-challenge-choosing');
  await expect(selectors).toHaveCount(0);
  await proxy.replay(roomId, { scene: 'zhajinhua-gameplay-challenge' });
  await expect(page.getByTestId('zhajinhua-compare-background')).toBeAttached();
  await captureTimeline(page, info, 'zhajinhua-challenge', page.getByTestId('zhajinhua-compare-background'),
    { clip, times: [0, 160, 500, 1000, 1600, 2200, 2600, 3200] });
  await expect(page.getByTestId('zhajinhua-compare-background')).toBeHidden();
  await proxy.replay(roomId, { scene: 'zhajinhua-gameplay-showdown' });
  const shownCards = page.locator('[data-testid="player_cards_container"]:visible');
  await expect(shownCards).toHaveCount(2);
  const faces = shownCards.getByTestId('sprite-image-content');
  await expect(faces).toHaveCount(6);
  await ensureLocalImagesLoaded(page);
  for (const face of await faces.all()) await expect(face).toHaveCSS('opacity', '1');
  await captureTimeline(page, info, 'zhajinhua-showdown', page.getByTestId('run-game-view'), { clip });
  await page.evaluate(() => {
    const state = window as typeof window & { animationParticleRandom?: typeof Math.random };
    state.animationParticleRandom = Math.random;
    let seed = 0x51f15e;
    Math.random = /** 固定粒子的随机输入，仍让每枚金币获得不同的真实轨迹。 */ () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
  });
  try {
    await proxy.replay(roomId, { scene: 'zhajinhua-gameplay-settlement' });
    await captureTimeline(page, info, 'zhajinhua-settlement', page.getByTestId('run-game-view'),
      { clip, times: [0, 160, 320, 800, 1600, 2800] });
  } finally {
    await page.evaluate(() => {
      const state = window as typeof window & { animationParticleRandom?: typeof Math.random };
      if (state.animationParticleRandom) Math.random = state.animationParticleRandom;
      delete state.animationParticleRandom;
    });
  }
  await expect(visible(page, `zhajinhua-player-container-${self}`)).toContainText('1120');
  await zhajinhuaFeedback(session, proxy, info);
}
