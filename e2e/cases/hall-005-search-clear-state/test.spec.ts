import { expect, test } from '../_shared/read-account-fixture';
import { formInput } from '../_shared/form';
import { unique } from '../_shared/page';
import { clickAfterSignInNotices } from '../_shared/sign-in-notices';

test('HALL-005：清空无结果搜索恢复默认引导', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await clickAfterSignInNotices(page, 'hall-search-button');
  await expect(await unique(page, 'club-search-default-empty')).toBeVisible();
  const search = await formInput(page, 'club-search-input');
  const keyword = `e2e-no-result-${Date.now()}`;
  await test.step('提交唯一关键字，真实搜索返回后显示结果空态', async () => {
    const response = page.waitForResponse(result => {
      const url = new URL(result.url());
      return url.pathname === '/v10/club/search' && url.searchParams.get('keyword') === keyword;
    });
    await search.fill(keyword);
    await search.press('Enter');
    const result = await response;
    expect(result.ok(), '真实搜索 HTTP 应成功').toBe(true);
    const body = await result.json();
    expect(body.ok, '真实搜索业务响应应成功').toBe(true);
    await expect(await unique(page, 'club-search-results-empty')).toBeVisible();
  });
  await test.step('清空关键字后移除结果空态，恢复初始引导', async () => {
    await search.clear();
    await expect(page.getByTestId('club-search-results-empty')).toBeHidden();
    await expect(await unique(page, 'club-search-default-empty')).toBeVisible();
  });
});
