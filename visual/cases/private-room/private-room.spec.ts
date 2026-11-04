import { test } from '@playwright/test';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';

for (const scenario of buildScenarios().filter(/** 仅保留满足以下条件的条目：`item.group === 'private-room'`。
 * @param item - 当前遍历的条目。 */ item => item.group === 'private-room')) {
  test(scenario.label, /** 执行当前私人房间页面场景的截图验证。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ browser }) => runVisualScenario(scenario, browser));
}
