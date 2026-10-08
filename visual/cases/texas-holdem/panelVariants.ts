import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { PANEL_VARIANT_STATES } from './scenarios';
import { events, REPLAY_PLAYER_IDS } from './replayData';
import { advance, click, closeMask, freezeClock, restore, selfId, visible } from './replay';
import { enableSetting, sequence, table, type Capture } from './variantSupport';

export async function capturePanelVariants(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  room: string, capture: Capture) {
  const self = await selfId(page);
  await freezeClock(page);
  await table(page, proxy, room, self);
  const { snapshot, done } = sequence(page, scenario, PANEL_VARIANT_STATES, capture);
  for (const mode of ['pending', 'resolved', 'more'] as const) {
    await proxy.configureUI({ applications: mode });
    await click(page, 'buy-in-application-button');
    await expect(page.locator('[data-testid="buy-in-application-nickname"]:visible')).toHaveCount(mode === 'resolved' ? 3 : 2);
    if (mode === 'pending') await expect(page.locator('[data-testid="buy-in-approved-applications-tab"]:visible')).toHaveCount(2);
    if (mode === 'resolved') await expect(page.locator('[data-testid="buy-in-application-status"]:visible')).toHaveCount(3);
    if (mode === 'more') await expect(visible(page, 'buy-in-application-list-more')).not.toHaveAttribute('aria-disabled', 'true');
    await snapshot(`applications_${mode}`);
    await closeMask(page, 'buy-in-application-list');
  }
  await enableSetting(page, 'player-voice');
  await proxy.replayTexas(room, { stream: 'room_message', payload: { action: 'audio', content: {
    from_user_id: REPLAY_PLAYER_IDS[0], from_user_nickname: 'Player1', duration: 3,
    codec: 'mp3', content: '',
  } } });
  await advance(page);
  await click(page, 'texas-holdem-chat-button');
  await click(page, '-in-game-chat-record-tab');
  await expect(visible(page, 'in-game-chat-audio-message-0')).toBeVisible();
  await snapshot('chat_audio_history');
  const barrageSwitch = visible(page, 'in-game-chat-barrage-switch');
  // 聊天弹幕开关用图片按钮呈现，初始为开启；点击后应切换到关闭图标。
  const barrageIcon = barrageSwitch.locator('img');
  const enabledIcon = await barrageIcon.getAttribute('src');
  expect(enabledIcon).toBeTruthy();
  await click(page, 'in-game-chat-barrage-switch');
  await expect(barrageIcon).not.toHaveAttribute('src', enabledIcon!);
  await snapshot('chat_barrage_off');
  await click(page, 'in-game-chat-mask');
  await proxy.configureUI({ rpcError: 'retry' });
  await click(page, 'texas-holdem-operation-button-call');
  await expect(visible(page, 'common-alert-message')).toContainText('Please retry');
  await snapshot('alert_retry');
  await page.getByText(/取消|Cancel/i, { exact: true }).last().click();
  await advance(page);
  await restore(page, proxy, room, self, 'flop', true);
  await proxy.configureUI({ rpcError: 'balance' });
  await proxy.replayTexas(room, events([{ event: 'settlement', players: [{ player_id: self, net: 180, prize: 180, stack: 1180 }] }]));
  await advance(page);
  await click(page, 'texas-holdem-show-remain-community-card-button');
  await expect(visible(page, 'common-alert-button-go_to_mall')).toBeVisible();
  await snapshot('alert_insufficient_balance');
  await click(page, 'common-alert-button-cancel');
  await proxy.configureUI({ rpcError: 'auth' });
  await table(page, proxy, room, self);
  await click(page, 'texas-holdem-operation-button-call');
  await expect(visible(page, 'common-alert-button-quit')).toBeVisible();
  await expect(visible(page, 'common-alert-title')).toContainText(/认证|認證|Authentication/i);
  await snapshot('alert_authentication_failed');
  done();
}
