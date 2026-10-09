import type { Page } from '@playwright/test';
import { expect, type TexasProxy } from './proxy';
import type { VisualScenario } from '../../scenarioTypes';
import { TABLE_STATES } from './scenarios';
import { events, REPLAY_PLAYER_IDS } from './replayData';
import { advance, click, freezeClock, selfId, visible } from './replay';
import { sequence, table, type Capture } from './variantSupport';

export async function captureTableStates(page: Page, scenario: VisualScenario, proxy: TexasProxy,
  room: string, capture: Capture) {
  const self = await selfId(page);
  await freezeClock(page);
  const { snapshot, done } = sequence(page, scenario, TABLE_STATES, capture);
  await table(page, proxy, room, self, { observer: true });
  await proxy.replayTexas(room, events([{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0],
    valid_bets: { call: { amount: 20 } } }]));
  await advance(page);
  await expect(visible(page, 'texas-holdem-self-seated-marker')).toBeHidden();
  await expect(visible(page, 'texas-holdem-operation-button-raise')).toBeHidden();
  await snapshot('observer');
  const clearHand = async () => {
    await proxy.replayTexas(room, events([{ event: 'new_game', game_id: 'visual-fixed-game',
      settings: { small_blind: 1, big_blind: 2, ante: 0 } }]));
    await advance(page);
    await expect(page.locator('[data-testid="player_card"]:visible')).toHaveCount(0);
  };
  await clearHand();
  await table(page, proxy, room, self, { full: true });
  await expect(page.locator('[data-testid^="texas-holdem-player-container-"]:visible')).toHaveCount(9);
  await snapshot('full_table');
  // 真实离桌消息移除额外玩家，再恢复五人牌桌，避免旧实体残留。
  await proxy.replayTexas(room, events(Array.from({ length: 4 }, (_, index) => ({ event: 'stand_up',
    player_id: `00000000-0000-4000-8000-${String(index + 5).padStart(12, '0')}` }))));
  await advance(page);
  await clearHand();
  await table(page, proxy, room, self);
  await proxy.replayTexas(room, events([{ event: 'reserve_seat', seat_number: 6,
    player_id: '00000000-0000-4000-8000-000000000005', remain_reserve_seconds: 120 }]));
  await advance(page);
  await expect(visible(page, 'seat-reserve-container')).toBeVisible();
  await expect(page.locator('[data-testid^="texas-holdem-player-container-"]:visible')).toHaveCount(5);
  await expect(page.locator('[data-testid="player_card"]:visible')).toHaveCount(8);
  await snapshot('reserved_seat');
  await proxy.replayTexas(room, events([{ event: 'cancel_reserve_seat', seat_number: 6 },
    { event: 'quit', player_id: REPLAY_PLAYER_IDS[2] }]));
  await page.clock.runFor(3500);
  await expect(visible(page, `texas-holdem-player-container-${REPLAY_PLAYER_IDS[2]}`)).toBeVisible();
  await snapshot('player_disconnected');
  await click(page, 'menu-button');
  await expect(visible(page, 'drawer-menu-item-renew')).toBeHidden();
  await expect(visible(page, 'drawer-menu-item-exit')).toBeVisible();
  await snapshot('guest_menu');
  done();
}
