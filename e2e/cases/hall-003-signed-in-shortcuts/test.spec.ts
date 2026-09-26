import { test, expect } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';

test('HALL-003：大厅搜索同时查询俱乐部和私人房间并返回', async ({ page, signedInAccount }) => {
  await test.step('打开已登录大厅搜索', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'hall-search-button')).click();
    await expect(await unique(page, 'club-search-input')).toHaveValue('');
  });
  await test.step('提交不存在的九位号码并验证联合查询空结果', async () => {
    const input = await unique(page, 'club-search-input');
    await input.fill('999999999');
    const clubSearch = page.waitForResponse(response => new URL(response.url()).pathname === '/v10/club/search');
    const roomSearch = page.waitForResponse(response => new URL(response.url()).pathname === '/v10/house/number/999999999');
    await input.press('Enter');
    await Promise.all([clubSearch, roomSearch]);
    // 线上联合搜索空态没有 data-testid，使用精确中文文案并检查唯一性。
    const empty = page.getByText('没有找到相关俱乐部或个人房间', { exact: true });
    await expect(empty).toHaveCount(1);
    await expect(empty).toBeVisible();
    await expect(input).toHaveValue('999999999');
  });
  await test.step('返回大厅并保持登录状态', async () => {
    await (await unique(page, 'club-search-back-button')).click();
    await expect(await unique(page, 'hall-auth-state-signed-in')).toBeVisible();
    await expect(await unique(page, 'hall-shortcut-buttons-container')).toBeVisible();
  });
});

test('HALL-003：通知、商城和邀请快捷入口可往返', async ({ page, signedInAccount }) => {
  await test.step('从消息通知进入三类消息列表再返回大厅', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'notification-button')).click();
    await expect(await unique(page, 'message-top-title')).toHaveText('消息');
    for (const kind of ['club', 'buy-in', 'system']) {
      await expect(await unique(page, `message-notification-item-${kind}`)).toBeVisible();
    }
    await (await unique(page, 'hall-tab')).click();
  });
  await test.step('从商店进入真实钻石商品列表再返回', async () => {
    await (await unique(page, 'store-button')).click();
    await expect(await unique(page, 'diamond-goods-list')).toContainText('颗钻石');
    await expect(await unique(page, 'product-price-0')).toHaveText(/^¥\d/);
    await (await unique(page, 'navigation-bar-back-image')).click();
    await expect(await unique(page, 'hall-auth-state-signed-in')).toBeVisible();
  });
  await test.step('打开邀请页面，核对下载和 H5 地址再返回', async () => {
    await (await unique(page, 'invite-friend-button')).click();
    await expect(await unique(page, 'come-and-play-text')).toHaveText('上来玩,定制您的专属牌局');
    await expect(await unique(page, 'download-url-text')).toHaveText('https://www.shafayouxi.org');
    await expect(await unique(page, 'url-text')).toHaveText('https://h5.shafayouxi.org');
    await expect(await unique(page, 'share-button')).toBeVisible();
    await (await unique(page, 'navigation-bar-back-image')).click();
    await expect(await unique(page, 'hall-shortcut-buttons-container')).toBeVisible();
  });
});

test('HALL-003：每日奖励展示七日签到和救济规则，浏览后返回', async ({ page, signedInAccount }) => {
  await test.step('打开每日奖励并检查七天奖励内容', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'daily-bonus-button')).click();
    const days = (await unique(page, 'CheckInDateList')).getByTestId('CheckInDateListItem');
    await expect(days).toHaveCount(7);
    for (let index = 0; index < 7; index++) {
      await expect(days.nth(index).getByTestId('CheckInDateListItem.title')).toHaveText(`${index + 1}天`);
      await expect(days.nth(index).getByTestId('CheckInDateListItem.rewardText')).toHaveText(/^\+\d+$/);
    }
    await expect(await unique(page, 'daily-bonus-check-in')).toBeVisible();
  });
  await test.step('查看说明并返回，不领取签到或救济金', async () => {
    await expect(await unique(page, 'daily-bonus-check-in-instructions-body')).toContainText('连续签到奖励更多');
    await expect(await unique(page, 'daily-bonus-relief-instructions-body')).toContainText('每天最多3次');
    await (await unique(page, 'navigation-bar-back-image')).click();
    await expect(await unique(page, 'hall-auth-state-signed-in')).toBeVisible();
  });
});
