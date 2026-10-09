import type { Page } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';
import { expect } from './proxy';
import { capture, click, closeMask, menu, stabilizeSeatGuides, visible } from './capture';
import { PRE_GAME_STATES } from './scenarios';

/**
 * 截取开局前的牌桌、菜单、设置及入座相关状态。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 */
export async function capturePreGame(page: Page, scenario: VisualScenario): Promise<void> {
  let index = 0;
  /**
   * 推进页面动效并按当前场景标签保存指定状态的截图。
   * @param state - 用于截图文件名的场景状态。
   */
  const snapshot = async (state: typeof PRE_GAME_STATES[number]) => {
    expect(state).toBe(PRE_GAME_STATES[index++]);
    await capture(page, scenario, state);
  };
  await stabilizeSeatGuides(page);
  await snapshot('waiting_table');
  await click(page, 'menu-button');
  await expect(visible(page, 'drawer-menu-item-exit')).toBeVisible();
  await snapshot('menu');
  await click(page, 'drawer-menu-item-card_rank');
  await expect(visible(page, 'drawer-menu-item-exit')).toBeHidden();
  await expect(visible(page, 'card-rank-list')).toBeVisible();
  await expect(page.locator('[data-testid^="card-rank-item-title-"]:visible')).toHaveCount(6);
  await snapshot('card_rank');
  await closeMask(page, 'card-rank-list');

  await menu(page, 'theme', 'game-settings-card-theme-simple');
  await snapshot('theme');
  await click(page, 'game-settings-close-button');
  await menu(page, 'settings', 'game-settings-popup-container');
  await snapshot('settings');
  await click(page, 'game-settings-close-button');
  // 公用 BuyInPopup 的 testID 沿用 texas-holdem 前缀，拼三张也使用该标记。
  await menu(page, 'buy_in', 'texas-holdem-buy-in-popup-visible-marker');
  await snapshot('buy_in');
  await click(page, 'buy-in-close-button');
  await menu(page, 'renew', 'renew-popup-close-button');
  await snapshot('renew');
  await click(page, 'renew-popup-close-button');
  await click(page, 'zhajinhua-learder-borard-button');
  await expect(visible(page, 'public-leader-board-container')).toBeVisible();
  await expect(visible(page, 'public-leader-board-empty')).toBeVisible();
  await expect(visible(page, 'public-leader-board-loading')).toBeHidden();
  await snapshot('leaderboard');
  await closeMask(page, 'public-leader-board-container');
  await click(page, 'game-record-button');
  await expect(visible(page, 'review-board-description-text')).toBeVisible();
  await snapshot('game_record');
  await closeMask(page, 'review-board-description-text');
  await click(page, 'zhajinhua-chat-button');
  await expect(visible(page, 'in-game-chat-container')).toBeVisible();
  await snapshot('chat');
  await click(page, 'in-game-chat-mask');
  await click(page, 'buy-in-application-button');
  await expect(visible(page, 'buy-in-application-list')).toBeVisible();
  await expect(visible(page, 'buy-in-application-no-requests')).toBeVisible();
  await snapshot('buy_in_applications');
  await closeMask(page, 'buy-in-application-list');

  await menu(page, 'theme', 'game-settings-card-theme-simple');
  for (const theme of ['four-color', 'four-color-two', 'realistic'] as const) {
    await click(page, `game-settings-card-theme-${theme}`);
    await snapshot(`theme_${theme.replaceAll('-', '_')}` as typeof PRE_GAME_STATES[number]);
  }
  await click(page, 'game-settings-card-theme-simple');
  await click(page, 'game-settings-close-button');
  for (const background of ['blue', 'purple', 'black'] as const) {
    await menu(page, 'theme', 'game-settings-card-theme-simple');
    await click(page, `game-settings-background-${background}`);
    await click(page, 'game-settings-close-button');
    await snapshot(`table_${background}`);
  }
  await menu(page, 'theme', 'game-settings-card-theme-simple');
  await click(page, 'game-settings-background-green');
  await click(page, 'game-settings-close-button');
  await menu(page, 'settings', 'game-settings-popup-container');
  const switches = page.locator('[data-testid^="game-settings-switch-"]:visible');
  expect(await switches.count()).toBeGreaterThanOrEqual(4);
  for (const control of await switches.all()) {
    if (!(await control.locator('input[type="checkbox"]').isChecked())) {
      await control.click();
    }
    await expect(control.locator('input[type="checkbox"]')).toBeChecked();
  }
  await snapshot('settings_enabled');
  expect(index).toBe(PRE_GAME_STATES.length);
}
