import type { Page } from '@playwright/test';
import { expect } from './proxy';
import { back, click, row, scrollList, visible } from './ui';
import type { RecordProxy } from './proxy';

export async function captureDetails(page: Page, version: 'legacy' | 'v2',
  snapshot: (state: string) => Promise<void>, proxy: RecordProxy): Promise<void> {
  const replayTab = () => version === 'legacy' ? visible(page, 'replay-tab-button')
    : page.getByRole('tab').filter({ hasText: /Replay|回放/i });
  for (const [name, prefix] of [['Private Texas', 'private'], ['Club Cards', 'club']] as const) {
    await scrollList(page, false);
    await row(page, name, version).click({ noWaitAfter: true });
    await expect(visible(page, 'detail-button')).toBeVisible();
    await expect(visible(page, 'game-name-value-text')).toHaveText(name);
    await expect(visible(page, 'game-record-player-item')).toHaveCount(2);
    await snapshot(`${prefix}_overview`);
    if (prefix === 'private') {
      const relationship = visible(page, version === 'legacy'
        ? 'player-name-text' : 'player-win-and-lose-relationship-list');
      await visible(page, 'game-record-player-item').first().click({ noWaitAfter: true });
      await expect(relationship).toHaveCount(1);
      await snapshot('private_relationship');
      await visible(page, 'game-record-player-item').last().click({ noWaitAfter: true });
      await expect(relationship).toHaveCount(1);
      await snapshot('private_relationship_switch');
      await visible(page, 'game-record-player-item').last().click({ noWaitAfter: true });
      await expect(relationship).toHaveCount(0);
    }
    await click(page, 'detail-button');
    await expect(visible(page, version === 'legacy' ? 'game-action-list-container' : 'review-board-action-list')).toBeVisible();
    await snapshot(`${prefix}_actions`);
    const tabs = page.getByTestId(/^(Game settlements|Settlement|牌局结算|牌局結算)$/i).filter({ visible: true });
    await expect(tabs).toHaveCount(1);
    await tabs.click({ noWaitAfter: true });
    await expect(visible(page, version === 'legacy' ? 'game-settlement-list' : 'review-board-settlement-list')).toBeVisible();
    await snapshot(`${prefix}_settlement`);
    await back(page, true);
    if (prefix === 'private') {
      await replayTab().click({ noWaitAfter: true });
      await expect(visible(page, 'game-replay-item')).toHaveCount(3);
      await expect(visible(page, 'display-net-text')).toHaveText(['+180', '-90', '0']);
      await snapshot('replay_list');
    }
    await back(page);
    await expect(visible(page, 'my-game-record-list')).toBeVisible();
  }
  await row(page, 'Hall Texas', version).click({ noWaitAfter: true });
  await expect(visible(page, version === 'legacy' ? 'game-hall-record-view' : 'game-record-player-item')).toBeVisible();
  await snapshot('hall_overview');
  await back(page);
  await scrollList(page, true);
  await row(page, 'Short Deck', version).click({ noWaitAfter: true });
  await expect(visible(page, 'detail-button')).toBeVisible();
  await expect(visible(page, 'game-name-value-text')).toHaveText('Short Deck');
  await snapshot('short_deck_overview');
  await back(page);
  await proxy.mode('no-hands');
  await back(page);
  await click(page, 'game-record');
  await row(page, 'No Hands', version).click({ noWaitAfter: true });
  await expect(visible(page, version === 'legacy' ? 'no-hands-text' : 'no-hands-footer')).toBeVisible();
  await expect(visible(page, 'detail-button')).toHaveCount(0);
  await snapshot('no_hands');
  await replayTab().click({ noWaitAfter: true });
  await expect(visible(page, 'no-replay-text')).toBeVisible();
  await expect(visible(page, 'game-replay-item')).toHaveCount(0);
  await snapshot('replay_empty');
  await back(page);
  await proxy.mode('list');
  await back(page);
  await click(page, 'game-record');
  await expect(row(page, 'Private Texas', version)).toBeVisible();
}
