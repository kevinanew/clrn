import type { Page } from '@playwright/test';
import { expect } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import type { TexasProxy } from './proxy';
import { events, REPLAY_PLAYER_IDS } from './replayData';
import { advance, click, closeMask, freezeClock, restore, selfId, visible } from './replay';
import { PANEL_STATES } from './scenarios';

type Capture = (page: Page, scenario: VisualScenario, state: string) => Promise<void>;

export async function capturePanels(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  roomId: string, capture: Capture): Promise<void> {
  const self = await selfId(page);
  await freezeClock(page);
  let index = 0;
  const snapshot = async (state: typeof PANEL_STATES[number]) => {
    expect(state).toBe(PANEL_STATES[index++]);
    await page.clock.runFor(500);
    await capture(page, scenario, state);
  };
  const menu = async (item: string) => {
    await click(page, 'menu-button');
    await click(page, `drawer-menu-item-${item}`);
  };
  await restore(page, proxy, roomId, self, 'flop', true);
  await menu('theme');
  for (const theme of ['four-color', 'four-color-two', 'realistic'] as const) {
    await click(page, `game-settings-card-theme-${theme}`);
    await snapshot(`theme_${theme.replaceAll('-', '_')}` as typeof PANEL_STATES[number]);
  }
  await click(page, 'game-settings-card-theme-simple');
  await click(page, 'game-settings-close-button');
  for (const background of ['blue', 'purple', 'black'] as const) {
    await menu('theme');
    await click(page, `game-settings-background-${background}`);
    await click(page, 'game-settings-close-button');
    await snapshot(`table_${background}`);
  }
  await menu('theme');
  await click(page, 'game-settings-background-green');
  await click(page, 'game-settings-close-button');
  await menu('settings');
  const switches = page.locator('[data-testid^="game-settings-switch-"]:visible');
  expect(await switches.count()).toBeGreaterThanOrEqual(4);
  for (const control of await switches.all()) {
    if (!(await control.locator('input[type="checkbox"]').isChecked())) {
      await control.click();
      await advance(page);
    }
  }
  await snapshot('settings_enabled');
  await click(page, 'game-settings-close-button');
  // 预热 Chromium 虚拟麦克风；只检查授权和弹窗，不发送录音。
  await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
  });
  await click(page, 'texas-holdem-voice-button');
  await expect(visible(page, 'in-game-audio-root-container')).toBeVisible();
  await snapshot('voice');
  await click(page, 'in-game-audio-popup-close');

  await click(page, 'texas-holdem-leaderboard-button');
  await expect(visible(page, 'public-leader-board-item-round-0')).toHaveText('10');
  await snapshot('leaderboard_players');
  await closeMask(page, 'public-leader-board-container');
  await click(page, 'game-record-button');
  await expect(page.locator('[data-testid="PlayerBenefitView_Container"]:visible')).toHaveCount(2);
  const recordPopup = visible(page, 'review-board-close-button')
    .locator('xpath=ancestor::*[*[@data-testid="screen-mask-touch-to-close"]][1]');
  await recordPopup.getByText(/settle|结算|結算/i).last().click();
  await advance(page);
  await expect(page.locator('[data-testid="TexasPlayerActionIcon_container"]:visible')).toHaveCount(0);
  await snapshot('record_settlement');
  const recordsTab = recordPopup.getByText(/detail|record|详情|詳情/i).last();
  await recordsTab.click();
  await advance(page);
  await expect(page.locator('[data-testid="TexasPlayerActionIcon_container"]:visible').first()).toBeVisible();
  await snapshot('record_actions');
  await click(page, 'review-board-close-button');

  await proxy.replayTexas(roomId, { stream: 'room_message', payload: { action: 'text', content: {
    from_user_id: REPLAY_PLAYER_IDS[0], from_user_nickname: 'Player1', text: 'Good hand!',
  } } });
  await click(page, 'texas-holdem-chat-button');
  await click(page, '-in-game-chat-message-tab');
  await expect(page.locator('[data-testid^="in-game-chat-phrase-"]:visible').first()).toBeVisible();
  await snapshot('chat_phrases');
  await click(page, '-in-game-chat-record-tab');
  await expect(visible(page, 'in-game-chat-text-message-0')).toContainText('Good hand!');
  await snapshot('chat_history');
  await click(page, 'in-game-chat-report-button-0');
  await expect(visible(page, 'in_game_report_message_component')).toBeVisible();
  await snapshot('chat_actions');
  await click(page, 'report_item_report');
  await expect(visible(page, 'report-popup-title')).toBeVisible();
  await snapshot('chat_report');
  await closeMask(page, 'report-popup-title');
  await click(page, 'in-game-chat-report-button-0');
  await click(page, 'report_item_block');
  await expect(visible(page, 'BlockPlayerConfirmPopup:title')).toBeVisible();
  await snapshot('chat_block_confirm');
  await click(page, 'BlockPlayerConfirmPopup:cancelButton');
  await click(page, 'in-game-chat-mask');

  await proxy.replayTexas(roomId, { stream: 'buy_in', payload: { action: 'apply_buy_in', content: {
    application_id: 'visual-application', user_id: REPLAY_PLAYER_IDS[1],
    user_nickname: 'Player2', nickname: 'Player2', amount: 500,
  } } });
  await expect(visible(page, 'buy-in-review-close-button')).toBeVisible();
  await snapshot('buy_in_review');
  await click(page, 'buy-in-review-close-button');

  await restore(page, proxy, roomId, self, 'flop', true);
  await proxy.replayTexas(roomId, events([{ event: 'settlement', players: [
    { player_id: self, net: 180, prize: 180, stack: 1180 },
  ] }]));
  await advance(page);
  await expect(visible(page, 'texas-holdem-show-hand-card-button')).toBeVisible();
  await expect(visible(page, 'texas-holdem-show-remain-community-card-button')).toBeVisible();
  await snapshot('hand_end');
  await click(page, 'texas-holdem-show-remain-community-card-button');
  await expect(visible(page, 'view-community-cards-container')).toBeVisible();
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return visible(page, 'view-community-cards-container')
      .locator('[data-testid="community_card_name_text"]').allTextContents();
  }, { timeout: 30_000 }).toEqual(['ah', 'kd', '7c', '2s', 'qs']);
  await snapshot('remaining_cards');
  await click(page, 'view-community-close-button');
  await click(page, 'texas-holdem-show-hand-card-button');
  await proxy.replayTexas(roomId, events([{ event: 'publish_hole_card', player_id: self,
    public_hole_card: ['as', 'ad'] }]));
  const published = visible(page, `texas-holdem-player-container-${self}`)
    .locator('[data-testid="texas-holdem-player-hole-cards"]');
  await expect(published).toBeVisible();
  await expect(published.locator('[data-testid="sprite-image-container"]')).toHaveCount(2);
  await expect(published.locator('[data-testid="poker-text-letter"]')).toHaveText(['a', 'a']);
  await expect(published.locator('[data-testid="poker-text-suit"]')).toHaveText(['♠', '♦']);
  await snapshot('show_cards');
  await restore(page, proxy, roomId, self, 'flop');
  await menu('exit');
  await expect(visible(page, 'common-alert-button-quit')).toBeVisible();
  await snapshot('quit_confirm');
  await click(page, 'common-alert-button-cancel');
  expect(index).toBe(PANEL_STATES.length);
}
