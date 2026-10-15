import { expect } from '@playwright/test';
import { REPLAY_PLAYER_IDS } from '../visual/cases/texas-holdem/replayData';
import { flattenNodes, gameGone, gameNodes, gameReady, gameSemanticText, gameTap, gameTextWithin } from './game-controls';
import { captureGameThemes, closeGameMask, gameMenu } from './game-pregame';
import { gameCardNames, replay } from './game-replay';
import { adb, applicationId } from './device';
import { dismissKeyboard } from './keyboard';
import { focusedCaretMask } from './screenshot';
import { translateCaret } from './caret-mask';
import { gameTapText, restoreTexas, texasEvents, type TexasContext } from './texas-support';

/**
 * 复用 Web 的二十一个面板、聊天、带入审核和手牌展示状态。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasPanels(context: TexasContext): Promise<void> {
  const { device, proxy, room, self, capture } = context;
  await restoreTexas(context, {}, 'flop', true);
  await captureGameThemes(device, capture);
  await gameTap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-popup-container');
  // 仅向专用模拟器授权；界面测试不录制或发送真实音频。
  adb('shell', 'pm', 'grant', applicationId, 'android.permission.RECORD_AUDIO');
  await gameTap(device, 'texas-holdem-voice-button');
  await gameReady(device, 'in-game-audio-root-container');
  await capture('voice');
  await gameTap(device, 'in-game-audio-popup-close');
  await gameGone(device, 'in-game-audio-root-container');
  await gameTap(device, 'texas-holdem-leaderboard-button');
  await gameReady(device, 'public-leader-board-item-round-0', '10');
  await capture('leaderboard_players');
  await closeGameMask(device, 'public-leader-board-container');
  await gameTap(device, 'game-record-button');
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'PlayerBenefitView_Container').length,
    { timeout: 30_000 }).toBe(2);
  await gameTapText(device, /settle|结算|結算/i);
  await gameGone(device, 'TexasPlayerActionIcon_container');
  /**
   * 通过真实输入固定页码焦点，只排除检测到的细光标，保留页码与边框。
   * @param state - 共用牌谱截图状态。
   */
  const captureRecord = async (state: string) => {
    await gameTap(device, 'review-board-page-input');
    await device.fill({ res: 'review-board-page-input' }, '1');
    const caret = await focusedCaretMask(device);
    expect(caret, '页码输入框应检测到真实细光标').toBeDefined();
    await dismissKeyboard(device);
    const input = await gameReady(device, 'review-board-page-input', '1');
    await capture(state, [translateCaret(caret!, input.bounds)]);
  };
  await captureRecord('record_settlement');
  await gameTapText(device, /^(Record|Details?|牌局详情|牌局詳情)$/i);
  await gameReady(device, 'TexasPlayerActionIcon_container');
  await captureRecord('record_actions');
  await gameTap(device, 'review-board-close-button');
  await gameGone(device, 'review-board-close-button');
  await replay(proxy, 'texas', room, { stream: 'room_message', payload: { action: 'text', content: {
    from_user_id: REPLAY_PLAYER_IDS[0], from_user_nickname: 'Player1', text: 'Good hand!',
  } } });
  await gameReady(device, 'barrage_text', 'Player1: Good hand!');
  await gameTap(device, 'texas-holdem-chat-button');
  await gameTap(device, '-in-game-chat-message-tab');
  await expect.poll(async () => (await gameNodes(device)).some(node => node.res?.startsWith('in-game-chat-phrase-')),
    { timeout: 30_000 }).toBe(true);
  await gameGone(device, 'barrage_text');
  await capture('chat_phrases');
  await gameTap(device, '-in-game-chat-record-tab');
  await expect.poll(async () => gameTextWithin(await gameNodes(device), 'in-game-chat-text-message-0'),
    { timeout: 30_000 }).toContain('Player1: Good hand!');
  await capture('chat_history');
  await gameTap(device, 'in-game-chat-report-button-0');
  await gameReady(device, 'in_game_report_message_component');
  await capture('chat_actions');
  await gameTap(device, 'report_item_report');
  await gameReady(device, 'report-popup-title');
  await dismissKeyboard(device);
  await capture('chat_report');
  await closeGameMask(device, 'report-popup-title');
  await gameTap(device, 'in-game-chat-report-button-0');
  await gameTap(device, 'report_item_block');
  await gameReady(device, 'BlockPlayerConfirmPopup:title');
  await capture('chat_block_confirm');
  await gameTap(device, 'BlockPlayerConfirmPopup:cancelButton');
  await gameGone(device, 'BlockPlayerConfirmPopup:title');
  const chat = (await gameReady(device, 'in-game-chat-mask')).bounds;
  adb('shell', 'input', 'tap', String(chat.x + 8), String(chat.y + 80));
  await gameGone(device, 'in-game-chat-container');
  await replay(proxy, 'texas', room, { stream: 'buy_in', payload: { action: 'apply_buy_in', content: {
    application_id: 'visual-application', user_id: REPLAY_PLAYER_IDS[1],
    user_nickname: 'Player2', nickname: 'Player2', amount: 500,
  } } });
  await gameReady(device, 'buy-in-review-close-button');
  await capture('buy_in_review');
  await gameTap(device, 'buy-in-review-close-button');
  await gameGone(device, 'buy-in-review-close-button');
  // 先清除旧回合的跟注标记，避免相同牌面让恢复等待误命中上一帧。
  /** 读取本轮本人实际可见的玩家容器。 */
  const ownPlayer = async () => (await gameNodes(device)).find(node => node.res === `texas-holdem-player-container-${self}`);
  /** 跟注标记由恢复玩家资料的回调设置，可作为该回调完成的证据。 */
  const ownCalled = async () => {
    const player = await ownPlayer();
    return Boolean(player && flattenNodes(player).some(node => node.res === 'texas-holdem-player-action-call'));
  };
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await expect.poll(ownCalled, { timeout: 30_000 }).toBe(false);
  await restoreTexas(context, {}, 'flop', true);
  await expect.poll(ownCalled, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => gameSemanticText(await ownPlayer(), 'text-holdem-own-balance-text'),
    { timeout: 30_000 }).toBe('1000');
  await texasEvents(context, [{ event: 'settlement', players: [{ player_id: self, net: 180, prize: 180, stack: 1180 }] }]);
  await expect.poll(async () => gameSemanticText(await ownPlayer(), 'text-holdem-own-balance-text'),
    { timeout: 30_000 }).toBe('1180');
  await gameReady(device, 'texas-holdem-show-hand-card-button');
  await gameReady(device, 'texas-holdem-show-remain-community-card-button');
  await capture('hand_end');
  await gameTap(device, 'texas-holdem-show-remain-community-card-button');
  await gameReady(device, 'view-community-cards-container');
  await gameCardNames(device, 'community_card', 'community_card_name_text', ['ah', 'kd', '7c', '2s', 'qs'], { scope: 'view-community-cards-container' });
  await capture('remaining_cards');
  await gameTap(device, 'view-community-close-button');
  await gameGone(device, 'view-community-cards-container');
  await gameTap(device, 'texas-holdem-show-hand-card-button');
  await texasEvents(context, [{ event: 'publish_hole_card', player_id: self, public_hole_card: ['as', 'ad'] }]);
  await gameReady(device, 'texas-holdem-player-hole-cards');
  await capture('show_cards');
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await restoreTexas(context, {}, 'flop');
  await gameMenu(device, 'exit', 'common-alert-button-quit');
  await capture('quit_confirm');
  await gameTap(device, 'common-alert-button-cancel');
}
