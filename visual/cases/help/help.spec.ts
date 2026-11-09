import { test } from '../../src/support/diagnosticTest';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';

for (const scenario of buildScenarios().filter(/** 选取帮助页面场景，注册帮助与下载相关截图用例。
 * @param item - 当前遍历的条目。 */ item => item.group === 'help')) {
  test(scenario.label, /** 执行当前帮助页面场景的截图验证。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser }) => runVisualScenario(scenario, browser));
}
