/** 运行钱包相关截图；货币流水使用逐条校验的固定收支场景。 */
import { test } from '../../src/support/diagnosticTest';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';
import { runCurrencyTransactionScenario } from './transactions';

for (const scenario of buildScenarios().filter(/** 仅保留满足以下条件的条目：`item.group === 'wallet'`。
 * @param item - 当前遍历的条目。 */ item => item.group === 'wallet')) {
  test(scenario.label,
    /**
     * 按页面类型选择固定流水校验或通用截图流程。
     * @param fixtures - Playwright 提供的浏览器。
     */
    async ({ browser }) => scenario.pageLabel.startsWith('signed_in_currency_transaction')
      ? runCurrencyTransactionScenario(scenario, browser) : runVisualScenario(scenario, browser));
}
