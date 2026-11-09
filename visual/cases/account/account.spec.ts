import { test } from '../../src/support/diagnosticTest';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';

for (const scenario of buildScenarios().filter(/** 选取账号页面场景，注册本套件的视觉用例。
 * @param item - 当前遍历的条目。 */ item => item.group === 'account')) {
  test(scenario.label, /** 执行当前账号页面场景的截图验证。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser }) => runVisualScenario(scenario, browser));
}
