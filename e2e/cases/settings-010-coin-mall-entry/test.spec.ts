import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { clickAfterSignInNotices } from '../_shared/sign-in-notices';

test('SETTINGS-010：金币余额入口保留真实余额并默认显示金币', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  let balance: string;
  await test.step('等待真实钱包响应并核对我的金币余额', async () => {
    const assetsResponse = page.waitForResponse(response =>
      /\/v10\/wallet\/[^/]+$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'PUT');
    await clickAfterSignInNotices(page, 'settings-tab');
    const response = await assetsResponse;
    expect(response.ok(), '钱包 HTTP 响应应成功').toBe(true);
    const assets: { ok: boolean; result: { currencies: { code: string; balance: string }[] } } = await response.json();
    expect(assets.ok, '钱包业务响应应成功').toBe(true);
    const coin = assets.result.currencies.find(asset => asset.code === 'coin');
    if (!coin) throw new Error('钱包响应缺少金币余额');
    balance = coin.balance;
    await expect(await unique(page, 'coin-balance-text')).toHaveText(balance);
  });
  await test.step('点击金币余额，商城保持余额且默认展示金币分类', async () => {
    await (await unique(page, 'coin-button')).click();
    await expect(await unique(page, 'base-mall-screen-container')).toHaveAttribute('data-currency-code', 'coin');
    await expect(await unique(page, 'mall-coin-balance-text')).toHaveText(balance);
    const coins = page.getByText('兑换金币', { exact: true });
    const giftCard = page.getByText(/^礼品卡在购买后不会直接增加钻石数量/);
    await expect(page.getByTestId('diamond-goods-list')).not.toBeInViewport();
    // 先确认已加载金币或已核实的礼品卡错页；空白、接口错误和其他错页仍为普通失败。
    await expect.poll(() => coins.or(giftCard).evaluateAll(elements => elements.filter(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden'
        && rect.width > 0 && rect.height > 0
        && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0;
    }).length), { message: '商城必须加载金币页或已确认的礼品卡错页' }).toBe(1);
    expect(await coins.count(), '金币标题应唯一或尚未挂载').toBeLessThanOrEqual(1);
    expect(await giftCard.count(), '礼品卡说明应唯一或尚未挂载').toBeLessThanOrEqual(1);
    // 仅最后的默认金币分类断言为预期失败；产品修复后会意外通过并要求移除此标记。
    test.fail(true, '2026-10-09 确认金币入口默认显示礼品卡；应用金币索引与标签顺序不一致');
    await expect(coins).toBeInViewport();
  });
});
