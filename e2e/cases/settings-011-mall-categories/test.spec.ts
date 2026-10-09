import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { openSettings } from '../_shared/settings-navigation';

test('SETTINGS-011：金币与钻石分类往返显示对应商品', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await openSettings(page, 'mall');
  const coins = page.getByText('兑换金币', { exact: true });
  await test.step('选择金币，金币商品进入视口且钻石列表离开视口', async () => {
    await (await unique(page, 'mall-tab-bar-Coin')).click();
    await expect(coins).toHaveCount(1);
    await expect(coins).toBeInViewport();
    await expect(page.getByText(/^[\d,]+枚金币$/).first()).toBeInViewport();
    await expect(page.getByTestId('diamond-goods-list')).not.toBeInViewport();
  });
  await test.step('选择钻石，真实价格可见且金币页离开视口', async () => {
    await (await unique(page, 'mall-tab-bar-Diamond')).click();
    await expect(coins).not.toBeInViewport();
    const diamonds = await unique(page, 'diamond-goods-list');
    await expect(diamonds).toBeInViewport();
    await expect(diamonds.locator('[data-testid^="product-price-"]').first()).toBeInViewport();
  });
  await test.step('再次选择金币，金币页重新进入视口', async () => {
    await (await unique(page, 'mall-tab-bar-Coin')).click();
    await expect(coins).toBeInViewport();
  });
});
