import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { openSettings } from '../_shared/settings-navigation';
import { expectStatementList, readStatements, type Statement } from './statements';

test('SETTINGS-012：钱包流水切换请求对应币种并恢复金币页', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await openSettings(page, 'mall');
  let coinStatements: Statement[] = [];
  await test.step('打开金币流水，真实接口成功且金币页进入视口', async () => {
    const coinResponse = page.waitForResponse(response =>
      /\/v11\/wallet\/[^/]+\/currency\/coin\/statement$/.test(new URL(response.url()).pathname));
    await (await unique(page, 'currency-transaction-record-button')).click();
    coinStatements = await readStatements(await coinResponse, 'coin');
    await expectStatementList(await unique(page, 'coin-transaction-record-view'), coinStatements);
  });
  await test.step('切换钻石，真实接口成功并展示钻石页', async () => {
    const diamondResponse = page.waitForResponse(response =>
      /\/v11\/wallet\/[^/]+\/currency\/diamond\/statement$/.test(new URL(response.url()).pathname));
    await (await unique(page, 'currency_transaction_top_tab_bar_diamond')).click();
    const diamondStatements = await readStatements(await diamondResponse, 'diamond');
    await expect(page.getByTestId('coin-transaction-record-view')).not.toBeInViewport();
    await expectStatementList(await unique(page, 'account-security-items-list'), diamondStatements);
  });
  await test.step('切回金币，金币流水重新进入视口', async () => {
    await (await unique(page, 'currency_transaction_top_tab_bar_coin')).click();
    await expectStatementList(await unique(page, 'coin-transaction-record-view'), coinStatements);
    await expect(page.getByTestId('account-security-items-list')).not.toBeInViewport();
  });
});
