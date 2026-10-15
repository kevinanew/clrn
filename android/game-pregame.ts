import type { AndroidDevice } from 'playwright';
import { expect } from '@playwright/test';
import { gameTap as tap, gameReady, gameGone, gameNodes } from './game-controls';
import { adb } from './device';
import presentation from '../visual/fixtures/account-presentation.json';


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
  await gameGone(device, 'drawer-menu-item-exit');
  await gameReady(device, ready);
}

/**
 * 点击真实弹层遮罩的边缘，避免点击其中央内容。
 * @param device - 专用模拟器连接。
 * @param marker - 当前面板标记。
 */
export async function closeGameMask(device: AndroidDevice, marker: string): Promise<void> {
  const { bounds } = await gameReady(device, 'screen-mask-touch-to-close');
  const panel = (await gameReady(device, marker)).bounds;
  const points = [
    { x: bounds.x + bounds.width - 8, y: bounds.y + Math.min(80, bounds.height / 2) },
    { x: bounds.x + 8, y: bounds.y + Math.min(80, bounds.height / 2) },
    { x: bounds.x + bounds.width - 8, y: bounds.y + bounds.height - 32 },
  ];
  const point = points.find(item => item.x < panel.x || item.x > panel.x + panel.width
    || item.y < panel.y || item.y > panel.y + panel.height);
  expect(point, '遮罩上应有未被当前面板覆盖的区域').toBeDefined();
  adb('shell', 'input', 'tap', String(Math.round(point!.x)), String(Math.round(point!.y)));
  await gameGone(device, marker);
}

/**
 * 共用两种玩法的开局前操作，严格按 Web 状态清单采集。
 * @param device - 专用模拟器连接。
 * @param game - 本轮玩法。
 * @param capture - 按共享状态名截图。
 */
export async function gamePreGame(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua', capture: Capture): Promise<void> {
  await gameReady(device, game === 'texas-holdem' ? 'texas-holdem-room-name-text' : 'zhajinhua-text-room-name', 'TestRoom');
  await capture('waiting_table');
  await tap(device, 'menu-button');
  await gameReady(device, 'drawer-menu-item-exit');
  await capture('menu');
  await tap(device, 'drawer-menu-item-card_rank');
  await gameReady(device, 'card-rank-list');
  await capture('card_rank');
  if ((await gameNodes(device)).some(node => node.res === 'card-rank-popup-close')) await tap(device, 'card-rank-popup-close');
  else await closeGameMask(device, 'card-rank-list');
  for (const [state, ready, close] of [
    ['theme', 'game-settings-card-theme-simple', 'game-settings-close-button'],
    ['settings', 'game-settings-popup-container', 'game-settings-close-button'],
    ['buy_in', 'texas-holdem-buy-in-popup-visible-marker', 'buy-in-close-button'],
    ['renew', 'renew-popup-close-button', 'renew-popup-close-button'],
  ]) {
    await gameMenu(device, state, ready);
    if (state === 'renew') {
      // 关闭按钮先于异步余额和续费价格出现，初始的两个 0 不能作为业务就绪。
      await expect.poll(async () => (await gameReady(device, 'renew-popup-remain-diamond')).text?.trim(),
        { timeout: 45_000 }).toBe(presentation.balance);
      await expect.poll(async () => Number((await gameReady(device, 'renew-popup-spend-diamond')).text?.trim()),
        { timeout: 45_000 }).toBeGreaterThan(0);
    }
    await capture(state);
    await tap(device, close);
    await gameGone(device, ready);
  }
  await tap(device, game === 'texas-holdem' ? 'texas-holdem-leaderboard-button' : 'zhajinhua-learder-borard-button');
  await gameReady(device, 'public-leader-board-empty');
  await gameGone(device, 'public-leader-board-loading');
  await capture('leaderboard');
  await closeGameMask(device, 'public-leader-board-container');
  await tap(device, 'game-record-button');
  await gameReady(device, 'review-board-description-text');
  await capture('game_record');
  // 战绩从右侧展开；说明文字只占面板中间，不能用其边界判断遮罩位置。
  const reviewMask = (await gameReady(device, 'screen-mask-touch-to-close')).bounds;
  adb('shell', 'input', 'tap', String(Math.round(reviewMask.x + 8)), String(Math.round(reviewMask.y + 80)));
  await gameGone(device, 'review-board-description-text');
  await tap(device, `${game}-chat-button`);
  await gameReady(device, 'in-game-chat-container');
  await capture('chat');
  const chat = (await gameReady(device, 'in-game-chat-mask')).bounds;
  adb('shell', 'input', 'tap', String(Math.round(chat.x + 8)), String(Math.round(chat.y + 80)));
  await gameGone(device, 'in-game-chat-container');
  await tap(device, 'buy-in-application-button');
  await gameReady(device, 'buy-in-application-no-requests');
  await capture('buy_in_applications');
  await closeGameMask(device, 'buy-in-application-list');
  if (game === 'texas-holdem') return;
  await captureGameThemes(device, capture);
}

/**
 * 两种玩法共用卡牌主题、牌桌背景和开关操作，维持同样的原生验证。
 * @param device - 专用模拟器连接。
 * @param capture - 当前玩法的共享状态截图入口。
 */
export async function captureGameThemes(device: AndroidDevice, capture: Capture): Promise<void> {
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  for (const theme of ['four-color', 'four-color-two', 'realistic']) {
    await tap(device, `game-settings-card-theme-${theme}`);
    await capture(`theme_${theme.replaceAll('-', '_')}`);
  }
  await tap(device, 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-card-theme-simple');
  for (const background of ['blue', 'purple', 'black']) {
    await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
    await tap(device, `game-settings-background-${background}`);
    await tap(device, 'game-settings-close-button');
    await gameGone(device, 'game-settings-card-theme-simple');
    await capture(`table_${background}`);
  }
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-background-green');
  await tap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-card-theme-simple');
  await gameMenu(device, 'settings', 'game-settings-popup-container');
  let count = 0;
  for (const name of ['sound-effect', 'vibrate', 'player-voice', 'show-card', 'operation-time', 'see-remain-card', 'shake-avatar']) {
    const selector = { res: `game-settings-switch-${name}` };
    if (!(await gameNodes(device)).some(node => node.res === selector.res)) continue;
    if (!(await gameReady(device, selector.res)).checked) await tap(device, selector.res);
    await expect.poll(async () => (await gameReady(device, selector.res)).checked,
      { timeout: 30_000 }).toBe(true);
    count++;
  }
  expect(count).toBeGreaterThanOrEqual(4);
  await capture('settings_enabled');
}
