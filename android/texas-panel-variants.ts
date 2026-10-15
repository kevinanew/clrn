import { expect } from '@playwright/test';
import { REPLAY_PLAYER_IDS } from '../visual/cases/texas-holdem/replayData';
import { gameGone, gameNodes, gameReady, gameTap } from './game-controls';
import { closeGameMask } from './game-pregame';
import { replay } from './game-replay';
import { adb } from './device';
import { enableGameSetting, restoreTexas, texasEvents, type TexasContext } from './texas-support';

/**
 * 复用 Web 的申请分页、音频历史、弹幕开关及三种 RPC 错误状态。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasPanelVariants(context: TexasContext): Promise<void> {
  const { device, proxy, room, self, capture } = context;
  await restoreTexas(context);
  for (const mode of ['pending', 'resolved', 'more'] as const) {
    await proxy.command('texas/ui', { applications: mode });
    await gameTap(device, 'buy-in-application-button');
    await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'buy-in-application-nickname').length,
      { timeout: 30_000 }).toBe(mode === 'resolved' ? 3 : 2);
    if (mode === 'pending') expect((await gameNodes(device)).filter(node => node.res === 'buy-in-approved-applications-tab')).toHaveLength(2);
    if (mode === 'resolved') expect((await gameNodes(device)).filter(node => node.res === 'buy-in-application-status')).toHaveLength(3);
    if (mode === 'more') expect((await gameReady(device, 'buy-in-application-list-more')).enabled).toBe(true);
    await capture(`applications_${mode}`);
    await closeGameMask(device, 'buy-in-application-list');
  }
  await enableGameSetting(device, 'player-voice');
  await replay(proxy, 'texas', room, { stream: 'room_message', payload: { action: 'audio', content: {
    from_user_id: REPLAY_PLAYER_IDS[0], from_user_nickname: 'Player1', duration: 3, codec: 'mp3', content: '',
  } } });
  await gameTap(device, 'texas-holdem-chat-button');
  await gameTap(device, '-in-game-chat-record-tab');
  await gameReady(device, 'in-game-chat-audio-message-0');
  await capture('chat_audio_history');
  await gameTap(device, 'in-game-chat-barrage-switch');
  await capture('chat_barrage_off');
  const chat = (await gameReady(device, 'in-game-chat-mask')).bounds;
  adb('shell', 'input', 'tap', String(chat.x + 8), String(chat.y + 80));
  await gameGone(device, 'in-game-chat-container');
  await proxy.command('texas/ui', { rpcError: 'retry' });
  await gameTap(device, 'texas-holdem-operation-button-call');
  expect((await gameReady(device, 'common-alert-message')).text).toContain('Please retry');
  // 操作错误弹窗没有 buttonId；与 Web 一样按真实按钮文字校验和操作。
  await expect.poll(async () => (await gameNodes(device)).some(node => /^(Retry|重试|重試)$/.test(node.text || '')),
    { timeout: 30_000 }).toBe(true);
  await capture('alert_retry');
  await device.tap({ text: /^(取消|Cancel)$/ });
  await restoreTexas(context, {}, 'flop', true);
  await proxy.command('texas/ui', { rpcError: 'balance' });
  await texasEvents(context, [{ event: 'settlement', players: [{ player_id: self, net: 180, prize: 180, stack: 1180 }] }]);
  await gameTap(device, 'texas-holdem-show-remain-community-card-button');
  await gameReady(device, 'common-alert-button-go_to_mall');
  await capture('alert_insufficient_balance');
  await gameTap(device, 'common-alert-button-cancel');
  await proxy.command('texas/ui', { rpcError: 'auth' });
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await restoreTexas(context);
  await gameGone(device, 'texas-holdem-show-hand-card-button');
  await gameGone(device, 'texas-holdem-show-remain-community-card-button');
  await gameTap(device, 'texas-holdem-operation-button-call');
  await gameReady(device, 'common-alert-button-quit');
  expect((await gameReady(device, 'common-alert-title')).text).toMatch(/^(身份验证失败|身份驗證失敗|Authentication failed)$/);
  await capture('alert_authentication_failed');
}
