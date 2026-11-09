/** 验证视觉套件的场景分配、截图数量和账号隔离。 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildScenarios } from './scenarios';
import { canTopUpVisualAccount, getVisualTestAccount } from './test-account';
import { getVisualSuite } from './visual-suite';
import type { BrowserContext } from '@playwright/test';
import { setupContextForScenario } from './src/support/pageSetup';
import { bindScenarioProxy } from '../e2e/helpers/scenario-proxy';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';

describe('visual suite selection and account isolation', /** 核对视觉套件选择与测试账号隔离。 */ () => {
  for (const scope of ['core', 'full']) {
    test(`${scope}：应用、德州和拼三张场景无遗漏且不重复`, /** 验证$\{scope\}：应用、德州和拼三张场景无遗漏且不重复。 */ () => {
      const env = { VISUAL_LOCALES: 'all', VISUAL_SCOPE: scope };
      const all = buildScenarios(env);
      const app = buildScenarios({ ...env, VISUAL_SUITE: 'app' });
      const texas = buildScenarios({ ...env, VISUAL_SUITE: 'texas' });
      const zhajinhua = buildScenarios({ ...env, VISUAL_SUITE: 'zhajinhua' });
      assert.equal(zhajinhua.length, 12);
      assert.equal(texas.length, 60);
      assert.equal(app.length, (scope === 'core' ? 50 : 117) * 3);
      assert.ok(app.every(/** 确认所有条目均满足：`scenario.group !== 'texas-holdem' && scenario.group !== 'zhajinhua'`。
 * @param scenario - 当前测试场景配置。 */ scenario => scenario.group !== 'texas-holdem' && scenario.group !== 'zhajinhua'));
      assert.ok(texas.every(/** 确认所有条目均满足：`scenario.group === 'texas-holdem'`。
 * @param scenario - 当前测试场景配置。 */ scenario => scenario.group === 'texas-holdem'));
      assert.deepEqual(
        [...app, ...texas, ...zhajinhua].map(/** 收集独立视觉套件的场景标签，核对合并后的覆盖范围。
 * @param scenario - 当前测试场景配置。 */ scenario => scenario.label).sort(),
        all.map(/** 收集完整视觉套件的场景标签，作为独立套件合并的比较基准。
 * @param scenario - 当前测试场景配置。 */ scenario => scenario.label).sort(),
      );
      /**
       * 汇总场景截图数量，展开游戏场景包含的多个状态。
       * @param scenarios - 当前候选视觉场景清单。
       */
      const screenshots = (scenarios: typeof all) => scenarios.reduce(
        /** 累计视觉场景的全部快照状态数量。
 * @param sum - 当前操作使用的 sum。
 * @param scenario - 当前测试场景配置。 */ (sum, scenario) => sum + (scenario.snapshotStates?.length || 1), 0,
      );
      assert.equal(screenshots(texas), 570);
      assert.equal(screenshots(app), scope === 'core' ? 510 : 711);
      assert.equal(screenshots(zhajinhua), 156);
      assert.equal(screenshots(app) + screenshots(texas) + screenshots(zhajinhua), screenshots(all));
    });
  }

  test('视觉准备只选择 Python 场景，不注册浏览器响应路由', /** 验证视觉准备只选择 Python 场景，不注册浏览器响应路由。 */ async () => {
    for (const suite of ['app', 'texas', 'zhajinhua'] as const) {
      const routes: RegExp[] = [];
      const context = {
        /** 忽略初始化脚本注册，仅验证场景网络路由配置。 */
        addInitScript: async () => {},
        /**
         * 收集注册的正则路由，验证游戏场景是否保留真实房间接口。
         * @param matcher - 待登记的网络路由匹配器。
         */
        route: async (matcher: unknown) => { if (matcher instanceof RegExp) routes.push(matcher); },
      } as unknown as BrowserContext;
      const commands: { endpoint: string; payload: unknown }[] = [];
      bindScenarioProxy(context, {
        /**
         * 记录场景选择，确认浏览器端没有响应载荷。
         * @param endpoint - 本机代理控制路径。
         * @param payload - 环境或具名场景命令。
         */
        command: async (endpoint: string, payload: unknown) => { commands.push({ endpoint, payload }); },
      } as unknown as Mitmproxy);
      const scenario = buildScenarios({ VISUAL_SUITE: suite, VISUAL_LOCALES: 'zh-Hans' })
        .find(/** 选择需要登录的视觉场景，验证独立套件的认证需求。
 * @param item - 当前遍历的条目。 */ item => item.signIn)!;
      await setupContextForScenario(context, scenario, undefined);
      assert.deepEqual(routes, []);
      assert.deepEqual(commands, [{ endpoint: 'fixtures/environment', payload: { visual: true } }]);
    }
  });

  test('invalid suite fails instead of silently selecting the wrong tests', /** 验证无效套件会明确失败，不会静默运行其他测试。 */ () => {
    assert.equal(getVisualSuite({}), 'all');
    assert.throws(/** 尝试生成未知套件的场景，验证配置拼写错误会立即失败。 */ () => buildScenarios({ VISUAL_SUITE: 'typo' }), /VISUAL_SUITE/);
  });

  test('texas has its own default account and explicit credentials remain supported', /** 验证德州使用独立默认账号，同时支持显式凭据。 */ () => {
    const app = getVisualTestAccount({ VISUAL_SUITE: 'app' });
    const texas = getVisualTestAccount({ VISUAL_SUITE: 'texas' });
    const zhajinhua = getVisualTestAccount({ VISUAL_SUITE: 'zhajinhua' });
    assert.equal(new Set([app.username, texas.username, zhajinhua.username]).size, 3);
    assert.equal(getVisualTestAccount({}).username, app.username);
    assert.deepEqual(getVisualTestAccount({
      VISUAL_SUITE: 'texas', VISUAL_USERNAME: 'custom', VISUAL_PASSWORD: 'password',
    }), { username: 'custom', password: 'password' });
  });

  test('balance updates only accept the fixed account selected for this run', /** 验证余额修改仅接受本轮选定的固定账号。 */ () => {
    assert.ok(canTopUpVisualAccount('laiwanvisualzjh01', { VISUAL_SUITE: 'zhajinhua' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisualzjh01', { VISUAL_SUITE: 'texas' }));
    assert.ok(canTopUpVisualAccount('laiwanvisual01', {}));
    assert.ok(canTopUpVisualAccount('laiwanvisualtexas01', { VISUAL_SUITE: 'texas' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisual01', { VISUAL_SUITE: 'texas' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisualtexas01', {}));
    assert.ok(!canTopUpVisualAccount('custom', { VISUAL_USERNAME: 'custom' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisual01', { VISUAL_USERNAME: 'custom' }));
    const ciAccount = 'clrnci26100901';
    assert.ok(canTopUpVisualAccount(ciAccount, { GITHUB_ACTIONS: 'true', VISUAL_USERNAME: ciAccount }));
    assert.ok(!canTopUpVisualAccount(ciAccount, { VISUAL_USERNAME: ciAccount }));
    assert.ok(!canTopUpVisualAccount('clrnci26100902', { GITHUB_ACTIONS: 'true', VISUAL_USERNAME: ciAccount }));
    assert.ok(!canTopUpVisualAccount('custom', { GITHUB_ACTIONS: 'true', VISUAL_USERNAME: 'custom' }));
  });
});
