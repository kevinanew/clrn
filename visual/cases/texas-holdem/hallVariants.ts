import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { HALL_VARIANT_STATES } from './scenarios';
import { events, REPLAY_PLAYER_IDS } from './replayData';
import { advance, click, freezeClock, selfId, visible } from './replay';
import { enableSetting, sequence, table, type Capture } from './variantSupport';

export async function captureHallVariants(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  room: string, capture: Capture) {
  const self = await selfId(page);
  await freezeClock(page);
  await table(page, proxy, room, self);
  const { snapshot, done } = sequence(page, scenario, HALL_VARIANT_STATES, capture);
  await proxy.configureUI({});
  await click(page, 'auto-rebuy-button');
  await click(page, 'auto-rebuy-switch');
  await expect(visible(page, 'auto-rebuy-switch').locator('input[type="checkbox"]')).toBeChecked();
  await expect(visible(page, 'common-alert-container')).toBeHidden();
  await snapshot('auto_rebuy_enabled');
  await click(page, 'auto-rebuy-close-button');
  await click(page, 'report-pair-play-button');
  const players = page.locator('[data-testid="select-player-button"]:visible');
  await expect(players).toHaveCount(4);
  await players.nth(0).click();
  await players.nth(1).click();
  await visible(page, 'report-pair-play-reason-input').fill('Suspicious cooperation');
  await advance(page);
  await snapshot('pair_play_selected');
  await click(page, 'report-pair-play-close-button');
  await proxy.replayTexas(room, events([{ event: 'settlement', players: [
    { player_id: REPLAY_PLAYER_IDS[0], net: 180, prize: 180, stack: 1140 },
  ] }]));
  await advance(page);
  await visible(page, 'bet-next-hand-button').first().click();
  await advance(page);
  await expect(visible(page, 'bet-next-hand-has-bet-icon')).toBeVisible();
  await expect(visible(page, 'bet-next-hand-placeholder')).toBeVisible();
  await snapshot('prediction_bet');
  await proxy.replayTexas(room, events([{ event: 'settlement_hand_prediction', result: { net: -10, currency_name: 'coin' } }]));
  await advance(page);
  await expect(visible(page, 'bet-next-hand-result-amount')).toHaveText('-10');
  await snapshot('prediction_loss');
  // 让上一条结果的三秒隐藏计时器结束，避免它提前收起新的结果。
  await page.clock.runFor(3500);
  await expect(visible(page, 'bet-next-hand-result-amount')).toBeHidden();
  await proxy.replayTexas(room, events([{ event: 'settlement_hand_prediction', result: { net: 20, currency_name: 'diamond' } }]));
  await advance(page);
  await expect(visible(page, 'bet-next-hand-result-amount')).toHaveText('+20');
  await snapshot('prediction_diamond');
  await proxy.replayTexas(room, events([{ event: 'new_game', game_id: 'visual-fixed-game',
    settings: { small_blind: 1, big_blind: 2, ante: 0 } }]));
  await advance(page);
  await table(page, proxy, room, self);
  await enableSetting(page, 'operation-time');
  await click(page, 'texas-holdem-delay-operation-button');
  // 操作回复收起加时按钮，再用真实恢复消息显示冷却中的按钮。
  await table(page, proxy, room, self);
  await page.clock.runFor(6000);
  await expect(visible(page, 'texas-holdem-delay-operation-button')).toContainText(':');
  await snapshot('delay_cooldown');
  await click(page, 'texas-holdem-delay-operation-button');
  await expect(visible(page, 'common-alert-message')).toContainText(/冷却|冷卻|cool/i);
  await snapshot('delay_cooldown_alert');
  done();
}
