import { randomUUID } from 'node:crypto';
import { test, expect } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';

test('俱乐部切换列表、真实搜索无匹配名称并返回', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await test.step('切换我的俱乐部与牌局列表', async () => {
    await (await unique(page, 'club-tab')).click();
    await expect(await unique(page, 'club-tab-screen')).toBeVisible();
    await (await unique(page, 'club_tab_room')).click();
    await expect(await unique(page, 'club-tab-screen')).toBeVisible();
    await (await unique(page, 'club_tab_my_club')).click();
    await expect(await unique(page, 'club-list-screen')).toBeVisible();
  });

  await test.step('从更多菜单打开搜索，并验证真实无匹配结果', async () => {
    await (await unique(page, 'show-more-button')).click();
    await expect(await unique(page, 'club-more-popup')).toBeVisible();
    const menu = await unique(page, 'popup-content-container');
    const search = menu.getByTestId('search-club-button');
    await expect(search).toHaveCount(1);
    await search.click();
    await expect(page.getByTestId('club-more-popup').filter({ visible: true })).toHaveCount(0);
    const input = await unique(page, 'club-search-input');
    await expect(input).toHaveAttribute('placeholder', '输入俱乐部名称/ID');
    // 每次全新完整 UUID，避免依赖现有线上俱乐部数据或申请加入别人的俱乐部。
    const keyword = `E2E${randomUUID().replaceAll('-', '')}`;
    const searched = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'GET'
        && url.pathname === '/v10/club/search'
        && url.searchParams.get('keyword') === keyword;
    });
    await input.fill(keyword);
    await input.press('Enter');
    const response = await searched;
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.result).toEqual([]);
    await expect(input).toHaveValue(keyword);
    await input.fill('');
    await expect(input).toHaveValue('');
  });

  await test.step('返回俱乐部列表和大厅', async () => {
    await (await unique(page, 'club-search-back-button')).click();
    await expect(await unique(page, 'club-tab-screen')).toBeVisible();
    await (await unique(page, 'hall-tab')).click();
    await expect(await unique(page, 'hall-auth-state-signed-in')).toBeVisible();
  });
});
