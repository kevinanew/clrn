import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { CONTROL_STATES } from './scenarios';
import { advance, click, closeMask, freezeClock, selfId, visible } from './replay';
import { autoButtons, sequence, table, type Capture } from './variantSupport';

export async function captureControls(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  room: string, capture: Capture) {
  const self = await selfId(page);
  await freezeClock(page);
  const { snapshot, done } = sequence(page, scenario, CONTROL_STATES, capture);
  const bets = { fold: {}, check: {}, raise: { minimum: 40, maximum: 1000 }, all_in: { amount: 1000 } };
  await table(page, proxy, room, self, { validBets: bets });
  await expect(visible(page, 'texas-holdem-operation-button-check')).toBeVisible();
  await snapshot('check');
  await table(page, proxy, room, self, { validBets: { fold: {}, all_in: { amount: 15 } } });
  await expect(visible(page, 'texas-holdem-operation-button-all_in')).toBeVisible();
  await expect(visible(page, 'texas-holdem-operation-button-call')).toBeHidden();
  await snapshot('all_in_only');
  await table(page, proxy, room, self, { validBets: { fold: {}, call: { amount: 15 }, all_in: { amount: 15 } } });
  await expect(visible(page, 'texas-holdem-operation-button-all_in')).toBeVisible();
  await expect(visible(page, 'texas-holdem-operation-button-call')).toBeVisible();
  await snapshot('all_in_call');
  await table(page, proxy, room, self, { pots: [3], validBets: bets });
  await expect(page.locator('[data-testid^="texas-holdem-shortcut-raise-button-"]:not([data-testid$="group"]):visible')).toHaveCount(4);
  await expect(visible(page, 'texas-holdem-shortcut-raise-button-double_big_blind')).toBeVisible();
  await snapshot('shortcut_blinds');
  await table(page, proxy, room, self, { validBets: { fold: {}, call: { amount: 20 },
    raise: { minimum: 40, maximum: 50 }, all_in: { amount: 50 } } });
  await expect(visible(page, 'texas-holdem-shortcut-raise-button-half_pot')).toHaveAttribute('aria-disabled', 'true');
  await snapshot('shortcut_disabled');
  await table(page, proxy, room, self);
  await autoButtons(page, proxy, room);
  await snapshot('auto_buttons');
  for (const [state, label] of [
    ['auto_fold_selected', /看或弃|看或棄|Check\/Fold/],
    ['auto_call_selected', /一跟到底|Any Call/],
    ['auto_check_selected', /自动看|自動看|^Check$/],
  ] as const) {
    await page.getByText(label).last().click();
    await advance(page);
    await snapshot(state);
  }
  await table(page, proxy, room, self);
  await click(page, 'texas-holdem-operation-button-raise');
  const slider = visible(page, 'raise-bet-slider');
  const thumb = visible(page, 'sliderThumb');
  const trackBox = await slider.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(trackBox && thumbBox).toBeTruthy();
  const x = thumbBox!.x + thumbBox!.width / 2;
  await page.mouse.move(x, thumbBox!.y + thumbBox!.height / 2);
  await page.mouse.down();
  // 游戏层有 CSS 缩放，真实拖动越过轨道上端，让控件按自身边界钳制到最大值。
  await page.mouse.move(x, Math.max(1, thumbBox!.y + thumbBox!.height / 2 - trackBox!.height * 2), { steps: 8 });
  await page.mouse.up();
  await advance(page);
  await expect(visible(page, 'raise-bet-display-text')).toHaveText('1000');
  await expect(visible(page, 'raise-bet-all-in-button')).toBeVisible();
  await snapshot('raise_maximum');
  const topThumb = await thumb.boundingBox();
  await page.mouse.move(x, topThumb!.y + topThumb!.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(x, trackBox!.y + trackBox!.height / 2, { steps: 8 });
    await advance(page);
    await expect(visible(page, 'raise-bet-assist-text')).toBeVisible();
    await snapshot('raise_dragging');
  } finally { await page.mouse.up(); }
  await click(page, 'raise-bet-cancel-button');
  await click(page, 'texas-holdem-operation-accurate-bet-button');
  for (const digit of [1, 2, 3]) await click(page, `texas-holdem-operation-accurate-bet-number-button-${digit}`);
  await expect(visible(page, 'accurate-bet-value-text')).toHaveText('123');
  await snapshot('accurate_raise_value');
  for (let i = 0; i < 3; i++) await click(page, 'texas-holdem-operation-accurate-bet-backspace-button');
  await click(page, 'texas-holdem-operation-accurate-bet-number-button-1');
  await click(page, 'texas-holdem-operation-accurate-bet-confirm-button');
  await expect(visible(page, 'toastText1')).toContainText('40');
  await snapshot('accurate_raise_minimum_error');
  await closeMask(page, 'accurate-bet-popup-container');
  done();
}
