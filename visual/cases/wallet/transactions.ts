/** 通过真实应用导航与 mitmproxy 固定流水，采集并校验金币、钻石页签。 */
import { expect, test, type Browser } from '../../src/support/diagnosticTest';
import path from 'node:path';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';
import { bindScenarioProxy, scenarioStatus } from '../../../e2e/helpers/scenario-proxy';
import { buildStorageStateForScenario, readAuthStateEntries, setupContextForScenario } from '../../src/support/pageSetup';
import { preparePage } from '../../src/support/preparePage';
import { visualBaseUrl } from '../../target';
import type { VisualScenario } from '../../scenarioTypes';
import { assertTransactionsReady, readTransactionFixture, waitForTransactionResponse } from './transactionReadiness';

/**
 * 保留真实登录和初始化，只隔离当前账号的只读流水；切换往返后再次核对当前内容。
 * @param scenario - 当前语言与手机视口下的金币或钻石截图配置。
 * @param browser - Playwright 提供的真实浏览器。
 */
export async function runCurrencyTransactionScenario(scenario: VisualScenario, browser: Browser): Promise<void> {
  const userId = JSON.parse(readAuthStateEntries()?.['save.user.origin.data.from.server.key'] || '{}').user_id;
  if (typeof userId !== 'string' || !userId) throw new Error('流水截图必须使用本轮真实登录账号');
  await withMitmproxy(
    /**
     * 为本例创建独占代理和浏览器上下文，退出时清理认证及代理资源。
     * @param network - 默认透传其他业务流量的代理。
     */
    async network => {
      const context = await browser.newContext({
        viewport: { width: scenario.viewport.width, height: scenario.viewport.height },
        locale: 'en-US', timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1,
        storageState: buildStorageStateForScenario(scenario, visualBaseUrl),
        proxy: { server: network.server, bypass: '<-loopback>' }, ignoreHTTPSErrors: true,
      });
      bindScenarioProxy(context, network);
      const page = await context.newPage();
      try {
        await setupContextForScenario(context, scenario, page);
        const coinScenario = { ...scenario,
          navClickTestIds: ['mall', 'currency-transaction-record-button'],
          visualReadySelector: '[data-testid="coin-transaction-record-view"]' };
        const [coinResponse] = await Promise.all([
          waitForTransactionResponse(page, userId, 'coin'),
          (/** 按真实初始化与商城入口进入金币流水，不跳过应用就绪检查。 */
            async () => { await page.goto(scenario.path); await preparePage(page, coinScenario); })(),
        ]);
        const coinStatements = await readTransactionFixture(coinResponse, 'coin');
        await assertTransactionsReady(page, 'coin', scenario.locale, coinStatements);
        const [diamondResponse] = await Promise.all([
          waitForTransactionResponse(page, userId, 'diamond'),
          page.getByTestId('currency_transaction_top_tab_bar_diamond').click(),
        ]);
        const diamondStatements = await readTransactionFixture(diamondResponse, 'diamond');
        await assertTransactionsReady(page, 'diamond', scenario.locale, diamondStatements);
        await page.getByTestId('currency_transaction_top_tab_bar_coin').click();
        await assertTransactionsReady(page, 'coin', scenario.locale, coinStatements);
        if (scenario.pageLabel.endsWith('_diamond')) {
          await page.getByTestId('currency_transaction_top_tab_bar_diamond').click();
          await assertTransactionsReady(page, 'diamond', scenario.locale, diamondStatements);
        }
        const status = await scenarioStatus(context);
        expect(status.observed, '两种币种的实际请求都必须命中本轮代理夹具')
          .toEqual(expect.arrayContaining(['wallet:coin', 'wallet:diamond']));
        await expect(page).toHaveScreenshot(`${scenario.label}.png`);
      } catch (error) {
        // 先在代理仍存活时取证；诊断和截图失败均不得覆盖原始异常。
        await (/** 收集代理连接和夹具状态，附加到失败报告。 */ async () => {
          const connections = await network.command('diagnostics');
          const fixture = await scenarioStatus(context);
          await test.info().attach('wallet-proxy-diagnostics', {
            body: JSON.stringify({ connections, fixture }), contentType: 'application/json',
          });
        })().catch(/** 诊断不可用时保留原失败结果。 */ () => undefined);
        await test.info().attach('流水校验失败页面', { body: await page.screenshot(), contentType: 'image/png' })
          .catch(/** 页面已关闭时仍抛出原始异常。 */ () => undefined);
        throw error;
      } finally {
        await context.close();
      }
    },
    { addonPath: path.resolve(__dirname, '../../../e2e/mitmproxy/wallet_diagnostics.py') },
  );
}
