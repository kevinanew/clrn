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
  await test.step('金币和钻石流水与真实接口一致，兼容没有注册奖励的账号', async () => {
    for (const currency of ['coin', 'diamond']) {
      // 在点击前监听页面自己的请求；空列表必须有成功响应，不能把加载失败当成空态。
      const recordsResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === `/v11/wallet/${signedInAccount.userId}/currency/${currency}/statement`
          && response.request().method() === 'GET';
      });
      if (currency === 'coin') {
        await (await unique(page, 'currency-transaction-record-button')).click();
      } else {
        await (await unique(page, 'currency_transaction_top_tab_bar_diamond')).click();
      }
      const response = await recordsResponse;
      expect(response.ok(), `${currency} 流水接口应成功`).toBe(true);
      const body = await response.json();
      expect(body.ok, `${currency} 流水业务响应应成功`).toBe(true);
      const statements = body.result?.statements;
      expect(Array.isArray(statements), '流水响应应包含列表').toBe(true);
      const view = await unique(page, currency === 'coin' ? 'coin-transaction-record-view' : 'account-security-items-list');
      const amounts = view.getByTestId('CurrencyTransactionRecordItem_amount');
      if (statements.length === 0) {
        await expect(amounts).toHaveCount(0);
      } else {
        const first = statements[0];
        expect(['deposit', 'withdraw']).toContain(first.event);
        await expect(amounts.first()).toHaveText(`${first.event === 'deposit' ? '+' : '-'}${first.amount}`);
        await expect(view.getByTestId('CurrencyTransactionRecordItem_balance').first()).toContainText(String(first.balance));
      }
    }
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
