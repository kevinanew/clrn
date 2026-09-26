import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';

test('SETTINGS-003：商城商品、钱包流水、购买记录和礼品卡浏览', async ({ page, signedInAccount }) => {
  await test.step('登录并打开商城，等待真实商品加载', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'settings-tab')).click();
    await (await unique(page, 'mall')).click();
    await expect(await unique(page, 'diamond-goods-list')).toContainText('颗钻石');
    await expect(await unique(page, 'product-amount-0')).toHaveText(/^\d+颗钻石$/);
    await expect(await unique(page, 'product-price-0')).toHaveText(/^¥\d/);
  });
  await test.step('查看金币流水中的注册奖励并返回商城', async () => {
    await (await unique(page, 'currency-transaction-record-button')).click();
    await expect(await unique(page, 'coin-transaction-record-view')).toContainText('注册奖励');
    await expect(page.getByTestId('CurrencyTransactionRecordItem_amount').filter({ visible: true }).first()).toHaveText(/^[+-]\d/);
    await goBack(page);
    await expect(await unique(page, 'diamond-goods-list')).toContainText('颗钻石');
  });
  await test.step('打开购买记录，确认空态并返回', async () => {
    await (await unique(page, 'purchase-history-button')).click();
    await expect(await unique(page, 'purchase-history-empty-text')).toHaveText('没有购买记录');
    await goBack(page);
    await expect(await unique(page, 'currency-transaction-record-button')).toBeVisible();
    await goBack(page);
  });
  await test.step('切换可用和过期礼品卡，打开兑换表单后返回', async () => {
    await (await unique(page, 'gift-card')).click();
    await expect(await unique(page, 'available-gift-card')).toHaveText('这里空空的');
    await (await unique(page, 'expired-gift-card-tab')).click();
    await expect(await unique(page, 'expired-gift-card')).toHaveText('这里空空的');
    await (await unique(page, 'available-gift-card-tab')).click();
    await expect(await unique(page, 'available-gift-card')).toHaveText('这里空空的');
    await (await unique(page, 'exchange-gift-card-button')).click();
    await expect(await unique(page, 'gift-card-input')).toHaveValue('');
    await expect(await unique(page, 'exchange-button')).toHaveText('立即兑换');
    await goBack(page);
    await expect(await unique(page, 'personal-gift-card-screen-container')).toContainText('可用的');
  });
});
