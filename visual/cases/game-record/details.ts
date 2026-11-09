import type { Page } from '@playwright/test';
import { expect } from './proxy';
import { back, click, reopen, row, scrollList, visible } from './ui';
import type { RecordProxy } from './proxy';

/**
 * 依次截取私人房与俱乐部战绩的概览、玩家信息和回放详情。
 * @param page - 执行操作的 Playwright 页面。
 * @param version - 战绩页面版本：legacy 或 v2。
 * @param snapshot - 按状态名保存当前场景截图的回调。
 * @param proxy - 本轮独占的代理控制对象。
 */
export async function captureDetails(page: Page, version: 'legacy' | 'v2',
  snapshot: (state: string) => Promise<void>, proxy: RecordProxy): Promise<void> {
  /** 按新旧战绩页面版本定位回放标签。 */
  const replayTab = () => version === 'legacy' ? visible(page, 'replay-tab-button')
    : page.getByRole('tab').filter({ hasText: /Replay|回放/i });
  /**
   * 按同一顺序检查每个房间的概览、关系与回放。
   * @param name - 房间名称。
   * @param prefix - 截图状态前缀。
   */
  const captureRoom = async (name: string, prefix: string) => {
    await scrollList(page, false);
    await row(page, name, version).click({ noWaitAfter: true });
    await expect(visible(page, 'detail-button')).toBeVisible();
    await expect(visible(page, 'game-name-value-text')).toHaveText(name);
    await expect(visible(page, 'game-record-player-item')).toHaveCount(2);
    await snapshot(`${prefix}_overview`);
    if (prefix === 'private') {
      const relationship = visible(page, { legacy: 'player-name-text', v2: 'player-win-and-lose-relationship-list' }[version]);
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
    await expect(visible(page, { legacy: 'game-action-list-container', v2: 'review-board-action-list' }[version])).toBeVisible();
    await snapshot(`${prefix}_actions`);
    const tabs = page.getByTestId(/^(Game settlements|Settlement|牌局结算|牌局結算)$/i).filter({ visible: true });
    await expect(tabs).toHaveCount(1);
    await tabs.click({ noWaitAfter: true });
    await expect(visible(page, { legacy: 'game-settlement-list', v2: 'review-board-settlement-list' }[version])).toBeVisible();
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
  };
  for (const [name, prefix] of [['Private Texas', 'private'], ['Club Cards', 'club']] as const) {
    await captureRoom(name, prefix);
  }
  await row(page, 'Hall Texas', version).click({ noWaitAfter: true });
  await expect(visible(page, { legacy: 'game-hall-record-view', v2: 'game-record-player-item' }[version])).toBeVisible();
  await snapshot('hall_overview');
  await back(page);
  await scrollList(page, true);
  await row(page, 'Short Deck', version).click({ noWaitAfter: true });
  await expect(visible(page, 'detail-button')).toBeVisible();
  await expect(visible(page, 'game-name-value-text')).toHaveText('Short Deck');
  await snapshot('short_deck_overview');
  await back(page);
  await proxy.mode('no-hands');
  await reopen(page);
  await row(page, 'No Hands', version).click({ noWaitAfter: true });
  await expect(visible(page, { legacy: 'no-hands-text', v2: 'no-hands-footer' }[version])).toBeVisible();
  await expect(visible(page, 'detail-button')).toHaveCount(0);
  await snapshot('no_hands');
  await replayTab().click({ noWaitAfter: true });
  await expect(visible(page, 'no-replay-text')).toBeVisible();
  await expect(visible(page, 'game-replay-item')).toHaveCount(0);
  await snapshot('replay_empty');
  await back(page);
  await proxy.mode('list');
  await reopen(page);
  await expect(row(page, 'Private Texas', version)).toBeVisible();
}
