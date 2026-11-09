/** 战绩新版列表、错误状态与请求隔离断言。 */
import type { Page } from '@playwright/test';
import { expect, type RecordProxy } from './proxy';
import { reopen, row, scrollList, visible } from './ui';
import { pagedRoomNames } from './listData';

type Version = 'legacy' | 'v2';

/**
 * 检查新版长列表的全量记录与末行挂载。
 * @param page - 当前场景的页面。
 * @param version - 当前场景的版本。
 * @param recordProxy - 当前场景的代理。
 */
export async function capturePagedV2(page: Page, version: Version, recordProxy: RecordProxy) {
  if (version !== 'v2') return;
  // 新版一次返回全部记录；长列表必须真实滚动才能看到末尾。
  await recordProxy.mode('paged');
  await reopen(page);
  await expect(row(page, 'Paged Texas 01', version)).toBeVisible();
  await expect(visible(page, 'loading-indicator')).toHaveCount(0);
  // SectionList 可能尚未挂载末行；先滚动并随内容高度更新继续滚动。
  await expect.poll(/** 滚动列表直到目标长房间名记录进入可见区域。 */ async () => {
    await scrollList(page, true);
    return row(page, 'Long Room Name', version).isVisible();
  }, { message: '滚动长列表后应挂载末条记录' }).toBe(true);
  await expect(page.locator('[data-testid^="record-visual-record-"]:visible')).toHaveCount(23);
  await expect(page.locator('[data-testid^="record-visual-record-"]:visible')
    .getByTestId('room-name-text')).toHaveText([
    'Private Texas', 'Club Cards', 'Hall Texas', ...pagedRoomNames,
    'Short Deck', 'No Hands', 'Long Room Name ABCDE',
  ]);
  await row(page, 'Long Room Name', version).scrollIntoViewIfNeeded();
}

/**
 * 检查新版列表已真实滚动且末行位于视口。
 * @param page - 当前场景的页面。
 * @param version - 当前场景的版本。
 */
export async function assertV2ListScroll(page: Page, version: Version) {
  if (version !== 'v2') return;
  await expect.poll(/** 重复读取`visible(page, 'my-game-record-list').evaluate(node => node.scrollTop)`，直到满足外层等待断言。 */ () => visible(page, 'my-game-record-list').evaluate(/** 在页面中读取`node.scrollTop`，供测试判断当前界面状态。
  * @param node - 当前遍历的 DOM 或语法节点。 */ node => node.scrollTop)).toBeGreaterThan(0);
  await expect(row(page, 'Long Room Name', version)).toBeInViewport();
}

/**
 * 恢复新版基础列表并确认分页记录退出。
 * @param page - 当前场景的页面。
 * @param version - 当前场景的版本。
 * @param recordProxy - 当前场景的代理。
 */
export async function restoreV2List(page: Page, version: Version, recordProxy: RecordProxy) {
  if (version !== 'v2') return;
  await recordProxy.mode('list');
  await reopen(page);
  await scrollList(page, false);
  await expect(row(page, 'Private Texas', version)).toBeVisible();
  await expect(page.locator('[data-testid^="record-visual-record-"]:visible')).toHaveCount(6);
  await expect(row(page, 'Paged Texas 01', version)).toHaveCount(0);
}

/**
 * 核对当前账号的真实请求覆盖与删除隔离。
 * @param version - 当前场景的版本。
 * @param recordProxy - 当前场景的代理。
 * @param userId - 当前场景的账号标识。
 */
export async function assertRecordRequests(version: Version, recordProxy: RecordProxy, userId: string) {
  const status = await recordProxy.status();
  if (version === 'v2') expect(status.deleted).toEqual([]);
  expect(Object.keys(status.recordRequests).length).toBeGreaterThan(5);
  expect(status.recordRequests[`/v1/game_log/user/${userId}/room/visual-record-private`] ?? 0).toBe(0);
  const faults = {
    legacy: [`/v1/game_log/user/${userId}/room/visual-record-hall`],
    v2: [`/v11/game_log/${userId}/play_session_record/recent`,
      `/v11/game_log/${userId}/play_session_record/visual-record-private`],
  }[version];
  faults.forEach(/** 每个预期故障接口都必须实际命中。
   * @param endpoint - 当前故障接口路径。 */ endpoint => expect(status.faultRequests[endpoint] ?? 0).toBeGreaterThan(0));
}
