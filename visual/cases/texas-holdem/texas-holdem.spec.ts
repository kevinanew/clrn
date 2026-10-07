import { expect, test, type Page } from '@playwright/test';
import { buildScenarios, type VisualScenario } from '../../scenarios';
import { visualBaseUrl } from '../../target';
import { buildStorageStateForScenario, setupContextForScenario } from '../../src/support/pageSetup';
import { ensureLocalImagesLoaded } from '../../src/support/pageStabilizers';
import { preparePage } from '../../src/support/preparePage';
import { createTexasRoom, deleteTexasRoom } from './room';
import { OPTIONAL_PRE_GAME_STATES, PRE_GAME_STATES } from './scenarios';
import { appliedGameTranslation, gameViewportCorrection } from './viewportAlignment';

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).last();

async function openMenuItem(page: Page, item: string, ready: string): Promise<void> {
  await visible(page, 'menu-button').click();
  await expect(visible(page, `drawer-menu-item-${item}`)).toBeVisible();
  await visible(page, `drawer-menu-item-${item}`).click();
  await expect(visible(page, ready)).toBeVisible({ timeout: 10_000 });
}

async function closePopup(page: Page, button: string, marker: string): Promise<void> {
  await visible(page, button).click();
  await expect(visible(page, marker)).toBeHidden({ timeout: 15_000 });
}

/** React Navigation 的游戏层有时相对视口偏移 ±4px；截图前归零。 */
async function alignGameToViewport(page: Page): Promise<void> {
  const game = visible(page, 'run-game-view');
  const { measuredTop, declaration } = await game.evaluate(node => {
    const element = node as HTMLElement;
    return {
      measuredTop: element.getBoundingClientRect().top,
      declaration: element.style.getPropertyValue('translate'),
    };
  });
  const correction = gameViewportCorrection(measuredTop, appliedGameTranslation(declaration));
  await game.evaluate((node, amount) => {
    const element = node as HTMLElement;
    element.style.setProperty('translate', `0 ${amount}px`, 'important');
  }, correction);
}

async function waitForGameConnection(page: Page): Promise<void> {
  await expect.poll(async () => {
    if (await visible(page, 'countdown-text').isVisible()) return true;
    const retry = visible(page, 'common-alert-button-retry');
    if (await retry.isVisible()) await retry.click();
    return false;
  }, { timeout: 90_000, message: '德州牌桌应连上游戏服务' }).toBe(true);
  await expect(visible(page, 'texas-holdem-start-room-timer-button')).toBeVisible({ timeout: 30_000 });
  await expect(visible(page, 'menu-button')).toBeVisible({ timeout: 30_000 });
  await expect(visible(page, 'texas-holdem-leaderboard-button')).toBeVisible({ timeout: 30_000 });
}

async function capture(page: Page, scenario: VisualScenario, state: string): Promise<void> {
  await alignGameToViewport(page);
  await ensureLocalImagesLoaded(page);
  await expect(page).toHaveScreenshot(`${scenario.label}_${state}.png`, { timeout: 20_000 });
}

async function capturePreGame(page: Page, scenario: VisualScenario): Promise<void> {
  let stateIndex = 0;
  const snapshot = async (state: typeof PRE_GAME_STATES[number]) => {
    expect(state, '截图顺序应与场景清单一致').toBe(PRE_GAME_STATES[stateIndex++]);
    await capture(page, scenario, state);
  };
  await expect(visible(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
  await expect(visible(page, 'texas-holdem-room-name-text')).toHaveText('TestRoom');
  await waitForGameConnection(page);
  await snapshot('waiting_table');

  await visible(page, 'menu-button').click();
  await expect(visible(page, 'drawer-menu-item-exit')).toBeVisible();
  await snapshot('menu');
  await visible(page, 'drawer-menu-item-card_rank').click();
  await expect(visible(page, 'card-rank-list')).toBeVisible();
  await snapshot('card_rank');
  await closePopup(page, 'card-rank-popup-close', 'card-rank-list');

  await openMenuItem(page, 'theme', 'game-settings-card-theme-simple');
  await snapshot('theme');
  await closePopup(page, 'game-settings-close-button', 'game-settings-card-theme-simple');
  await openMenuItem(page, 'settings', 'game-settings-popup-container');
  await snapshot('settings');
  await closePopup(page, 'game-settings-close-button', 'game-settings-popup-container');

  await openMenuItem(page, 'buy_in', 'texas-holdem-buy-in-popup-visible-marker');
  await snapshot('buy_in');
  await closePopup(page, 'buy-in-close-button', 'texas-holdem-buy-in-popup-visible-marker');
  await openMenuItem(page, 'renew', 'renew-popup-close-button');
  await snapshot('renew');
  await closePopup(page, 'renew-popup-close-button', 'renew-popup-close-button');

  await visible(page, 'texas-holdem-leaderboard-button').click();
  await expect(visible(page, 'public-leader-board-container')).toBeVisible({ timeout: 30_000 });
  await snapshot('leaderboard');
  await visible(page, 'screen-mask-touch-to-close').evaluate(node => (node as HTMLElement).click());
  await expect(visible(page, 'public-leader-board-container')).toBeHidden({ timeout: 15_000 });
  await visible(page, 'game-record-button').click();
  await expect(visible(page, 'review-board-description-text')).toBeVisible({ timeout: 30_000 });
  await snapshot('game_record');
  await visible(page, 'screen-mask-touch-to-close').evaluate(node => (node as HTMLElement).click());
  await expect(visible(page, 'review-board-description-text')).toBeHidden({ timeout: 15_000 });

  await visible(page, 'texas-holdem-chat-button').click();
  await expect(visible(page, 'in-game-chat-container')).toBeVisible();
  await snapshot('chat');
  await closePopup(page, 'in-game-chat-mask', 'in-game-chat-container');
  await visible(page, 'buy-in-application-button').click();
  await expect(visible(page, 'buy-in-application-list')).toBeVisible();
  await snapshot('buy_in_applications');
  expect(stateIndex).toBe(PRE_GAME_STATES.length);
}

async function captureOptionalPreGame(page: Page, scenario: VisualScenario): Promise<void> {
  await expect(visible(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
  await waitForGameConnection(page);
  await expect(visible(page, 'texas-holdem-raise-blind-button')).toBeVisible();
  await capture(page, scenario, OPTIONAL_PRE_GAME_STATES[0]);

  await visible(page, 'texas-holdem-raise-blind-button').click();
  await expect(visible(page, 'raise-blind-detail')).toBeVisible();
  await expect(visible(page, 'raise-blind-loading')).toBeHidden({ timeout: 30_000 });
  await expect(visible(page, 'blinds-structure-list')).toBeVisible();
  await capture(page, scenario, OPTIONAL_PRE_GAME_STATES[1]);
}

for (const scenario of buildScenarios().filter(item => item.group === 'texas-holdem')) {
  test(scenario.label, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      locale: 'en-US',
      deviceScaleFactor: 1,
      storageState: buildStorageStateForScenario(scenario, visualBaseUrl),
    });
    const page = await context.newPage();
    let room: Awaited<ReturnType<typeof createTexasRoom>> | undefined;
    try {
      await setupContextForScenario(context, scenario, page);
      await page.goto(scenario.path);
      await preparePage(page, scenario);
      const optional = scenario.pageLabel === 'signed_in_texas_optional_pre_game';
      room = await createTexasRoom(page, created => { room = created; }, optional);
      if (optional) await captureOptionalPreGame(page, scenario);
      else await capturePreGame(page, scenario);
    } finally {
      try {
        if (room) await deleteTexasRoom(page, room);
      } finally {
        await context.close();
      }
    }
  });
}
