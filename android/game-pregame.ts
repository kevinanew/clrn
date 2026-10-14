import type { AndroidDevice } from 'playwright';
import { expect } from '@playwright/test';
import { tap } from './navigation';
import { exists, waitAbsent } from './native-state';

type Capture = (state: string) => Promise<void>;

/**
 * 打开与 Web 相同的牌桌菜单项，并等待原生面板就绪。
 * @param device - 专用模拟器连接。
 * @param item - 共用菜单标记。
 * @param ready - 面板就绪标记。
 */
export async function gameMenu(device: AndroidDevice, item: string, ready: string): Promise<void> {
  await tap(device, 'menu-button');
  await tap(device, `drawer-menu-item-${item}`);
  await waitAbsent(device, { res: 'drawer-menu-item-exit' });
  await device.wait({ res: ready });
}

/**
 * 点击真实弹层遮罩的边缘，避免点击其中央内容。
 * @param device - 专用模拟器连接。
 * @param marker - 当前面板标记。
 */
export async function closeGameMask(device: AndroidDevice, marker: string): Promise<void> {
  const { bounds } = await device.info({ res: 'screen-mask-touch-to-close' });
  await device.input.tap({ x: bounds.x + 8, y: bounds.y + 8 });
  await waitAbsent(device, { res: marker });
}

/**
 * 共用两种玩法的开局前操作，严格按 Web 状态清单采集。
 * @param device - 专用模拟器连接。
 * @param game - 本轮玩法。
 * @param capture - 按共享状态名截图。
 */
export async function gamePreGame(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua', capture: Capture): Promise<void> {
  await device.wait({ res: game === 'texas-holdem' ? 'texas-holdem-room-name-text' : 'zhajinhua-text-room-name', text: 'TestRoom' });
  await capture('waiting_table');
  await tap(device, 'menu-button');
  await device.wait({ res: 'drawer-menu-item-exit' });
  await capture('menu');
  await tap(device, 'drawer-menu-item-card_rank');
  await device.wait({ res: 'card-rank-list' });
  await capture('card_rank');
  if (await exists(device, { res: 'card-rank-popup-close' })) await tap(device, 'card-rank-popup-close');
  else await closeGameMask(device, 'card-rank-list');
  for (const [state, ready, close] of [
    ['theme', 'game-settings-card-theme-simple', 'game-settings-close-button'],
    ['settings', 'game-settings-popup-container', 'game-settings-close-button'],
    ['buy_in', 'texas-holdem-buy-in-popup-visible-marker', 'buy-in-close-button'],
    ['renew', 'renew-popup-close-button', 'renew-popup-close-button'],
  ]) {
    await gameMenu(device, state, ready);
    await capture(state);
    await tap(device, close);
    await waitAbsent(device, { res: ready });
  }
  await tap(device, game === 'texas-holdem' ? 'texas-holdem-leaderboard-button' : 'zhajinhua-learder-borard-button');
  await device.wait({ res: 'public-leader-board-empty' });
  await waitAbsent(device, { res: 'public-leader-board-loading' });
  await capture('leaderboard');
  await closeGameMask(device, 'public-leader-board-container');
  await tap(device, 'game-record-button');
  await device.wait({ res: 'review-board-description-text' });
  await capture('game_record');
  await closeGameMask(device, 'review-board-description-text');
  await tap(device, `${game}-chat-button`);
  await device.wait({ res: 'in-game-chat-container' });
  await capture('chat');
  const chat = (await device.info({ res: 'in-game-chat-mask' })).bounds;
  await device.input.tap({ x: chat.x + 8, y: chat.y + 8 });
  await waitAbsent(device, { res: 'in-game-chat-container' });
  await tap(device, 'buy-in-application-button');
  await device.wait({ res: 'buy-in-application-no-requests' });
  await capture('buy_in_applications');
  await closeGameMask(device, 'buy-in-application-list');
  if (game === 'texas-holdem') return;
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  for (const theme of ['four-color', 'four-color-two', 'realistic']) {
    await tap(device, `game-settings-card-theme-${theme}`);
    await capture(`theme_${theme.replaceAll('-', '_')}`);
  }
  await tap(device, 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-close-button');
  for (const background of ['blue', 'purple', 'black']) {
    await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
    await tap(device, `game-settings-background-${background}`);
    await tap(device, 'game-settings-close-button');
    await capture(`table_${background}`);
  }
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-background-green');
  await tap(device, 'game-settings-close-button');
  await gameMenu(device, 'settings', 'game-settings-popup-container');
  let count = 0;
  for (const name of ['sound-effect', 'vibrate', 'player-voice', 'show-card', 'operation-time', 'see-remain-card', 'shake-avatar']) {
    const selector = { res: `game-settings-switch-${name}` };
    if (!await exists(device, selector)) continue;
    if (!(await device.info(selector)).checked) await tap(device, selector.res);
    expect((await device.info(selector)).checked).toBe(true);
    count++;
  }
  expect(count).toBeGreaterThanOrEqual(4);
  await capture('settings_enabled');
}
