import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { events, REPLAY_PLAYER_IDS, restoreTable, type TableOptions } from './replayData';
import { advance, click, visible } from './replay';

export type Capture = (page: Page, scenario: VisualScenario, state: string) => Promise<void>;

/** 每个视觉分支必须按清单截图，并在结束时确认没有遗漏。 */
export function sequence(page: Page, scenario: VisualScenario, states: readonly string[], capture: Capture) {
  let index = 0;
  return {
    snapshot: async (state: string) => {
      expect(state).toBe(states[index++]);
      await page.clock.runFor(500);
      await capture(page, scenario, state);
    },
    done: () => expect(index).toBe(states.length),
  };
}

export async function table(page: Page, proxy: TexasProxy, room: string, self: string,
  options: TableOptions = {}, opponent = false) {
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return proxy.replayTexas(room, restoreTable(self, 'river', opponent, options)).then(() => true, () => false);
  }, { timeout: 30_000, message: '等待本房间实际订阅后再发送视觉状态' }).toBe(true);
  await page.clock.runFor(3000);
  await expect.poll(async () => {
    await page.clock.runFor(250);
    return page.locator('[data-testid="community_card_name_text"]').allTextContents();
  }).toEqual(['ah', 'kd', '7c', '2s', 'qs']);
}

export async function autoButtons(page: Page, proxy: TexasProxy, room: string) {
  await proxy.replayTexas(room, events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0],
    valid_bets: { call: { amount: 20 } } }]));
  await advance(page);
  await expect(page.getByText(/看或弃|看或棄|Check\/Fold/).last()).toBeVisible();
  await expect(visible(page, 'texas-holdem-operation-button-raise')).toBeHidden();
}

export async function menu(page: Page, item: string) {
  await click(page, 'menu-button');
  await click(page, `drawer-menu-item-${item}`);
}

export async function enableSetting(page: Page, id: string) {
  await menu(page, 'settings');
  const control = visible(page, `game-settings-switch-${id}`);
  if (!(await control.locator('input[type="checkbox"]').isChecked())) await click(page, `game-settings-switch-${id}`);
  await click(page, 'game-settings-close-button');
}
