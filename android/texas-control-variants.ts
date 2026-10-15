import { expect } from '@playwright/test';
import { REPLAY_PLAYER_IDS } from '../visual/cases/texas-holdem/replayData';
import { gameGone, gameNodes, gameReady, gameTap, gameMarker } from './game-controls';
import { closeGameMask } from './game-pregame';
import { adb } from './device';
import { gameTapText, restoreTexas, texasEvents, type TexasContext } from './texas-support';

/**
 * 与 Web 共用十三个操作分支，实际点击、拖动原生控件并检查结果。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasControlVariants(context: TexasContext): Promise<void> {
  const { device, capture } = context;
  const bets = { fold: {}, check: {}, raise: { minimum: 40, maximum: 1000 }, all_in: { amount: 1000 } };
  await restoreTexas(context, { validBets: bets });
  await gameReady(device, 'texas-holdem-operation-button-check');
  await capture('check');
  await restoreTexas(context, { validBets: { fold: {}, all_in: { amount: 15 } } });
  await gameReady(device, 'texas-holdem-operation-button-all_in');
  await gameGone(device, 'texas-holdem-operation-button-call');
  await capture('all_in_only');
  await restoreTexas(context, { validBets: { fold: {}, call: { amount: 15 }, all_in: { amount: 15 } } });
  await gameReady(device, 'texas-holdem-operation-button-all_in');
  await gameReady(device, 'texas-holdem-operation-button-call');
  await capture('all_in_call');
  await restoreTexas(context, { pots: [3], validBets: bets });
  await gameReady(device, 'texas-holdem-shortcut-raise-button-double_big_blind');
  expect((await gameNodes(device)).filter(node => node.res?.startsWith('texas-holdem-shortcut-raise-button-')
    && !node.res.endsWith('group'))).toHaveLength(4);
  await capture('shortcut_blinds');
  await restoreTexas(context, { validBets: { fold: {}, call: { amount: 20 },
    raise: { minimum: 40, maximum: 50 }, all_in: { amount: 50 } } });
  expect((await gameReady(device, 'texas-holdem-shortcut-raise-button-half_pot')).enabled).toBe(false);
  await capture('shortcut_disabled');
  await restoreTexas(context);
  await texasEvents(context, [{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0], valid_bets: { call: { amount: 20 } } }]);
  await gameGone(device, 'texas-holdem-operation-button-raise');
  await expect.poll(async () => (await gameNodes(device)).some(node => /看或弃|看或棄|Check\/Fold/.test(node.text || ''))).toBe(true);
  await capture('auto_buttons');
  for (const [state, label] of [
    ['auto_fold_selected', /看或弃|看或棄|Check\/Fold/],
    ['auto_call_selected', /一跟到底|Any Call/],
    ['auto_check_selected', /自动看|自動看|^Check$/],
  ] as const) {
    await gameTapText(device, label);
    await capture(state);
  }
  await restoreTexas(context);
  await gameTap(device, 'texas-holdem-operation-button-raise');
  const track = (await gameReady(device, 'raise-bet-slider')).bounds;
  const thumb = (await gameReady(device, 'sliderThumb')).bounds;
  const x = Math.round(thumb.x + thumb.width / 2);
  adb('shell', 'input', 'swipe', String(x), String(Math.round(thumb.y + thumb.height / 2)),
    String(x), String(Math.max(1, Math.round(track.y - 20))), '600');
  await gameReady(device, 'raise-bet-display-text', '1000');
  await gameReady(device, 'raise-bet-all-in-button');
  await capture('raise_maximum');
  const topThumb = (await gameReady(device, 'sliderThumb')).bounds;
  adb('shell', 'input', 'motionevent', 'DOWN', String(x), String(Math.round(topThumb.y + topThumb.height / 2)));
  try {
    adb('shell', 'input', 'motionevent', 'MOVE', String(x), String(Math.round(track.y + track.height / 2)));
    await gameReady(device, 'raise-bet-assist-text');
    await capture('raise_dragging');
  } finally { adb('shell', 'input', 'motionevent', 'UP', String(x), String(Math.round(track.y + track.height / 2))); }
  await gameTap(device, 'raise-bet-cancel-button');
  await gameTap(device, 'texas-holdem-operation-accurate-bet-button');
  for (const digit of [1, 2, 3]) await gameTap(device, `texas-holdem-operation-accurate-bet-number-button-${digit}`);
  await gameReady(device, 'accurate-bet-value-text', '123');
  await capture('accurate_raise_value');
  for (let index = 0; index < 3; index++) await gameTap(device, 'texas-holdem-operation-accurate-bet-backspace-button');
  await gameTap(device, 'texas-holdem-operation-accurate-bet-number-button-1');
  await capture('accurate_raise_minimum_error', [], async () => {
    await gameTap(device, 'texas-holdem-operation-accurate-bet-confirm-button');
    await expect.poll(async () => (await gameMarker(device, 'toastText1'))?.text,
      { timeout: 3000, intervals: [20] }).toContain('40');
  });
  await closeGameMask(device, 'accurate-bet-popup-container');
}
