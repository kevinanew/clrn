import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildScenarios } from './scenarios';
import { canTopUpVisualAccount, getVisualTestAccount } from './test-account';
import { getVisualSuite } from './visual-suite';
import type { BrowserContext } from '@playwright/test';
import { setupContextForScenario } from './src/support/pageSetup';

describe('visual suite selection and account isolation', () => {
  for (const scope of ['core', 'full']) {
    test(`${scope}: app, texas and zhajinhua partition all locales without losing or duplicating scenarios`, () => {
      const env = { VISUAL_LOCALES: 'all', VISUAL_SCOPE: scope };
      const all = buildScenarios(env);
      const app = buildScenarios({ ...env, VISUAL_SUITE: 'app' });
      const texas = buildScenarios({ ...env, VISUAL_SUITE: 'texas' });
      const zhajinhua = buildScenarios({ ...env, VISUAL_SUITE: 'zhajinhua' });
      assert.equal(zhajinhua.length, 12);
      assert.equal(texas.length, 60);
      assert.equal(app.length, (scope === 'core' ? 44 : 106) * 3);
      assert.ok(app.every(scenario => scenario.group !== 'texas-holdem' && scenario.group !== 'zhajinhua'));
      assert.ok(texas.every(scenario => scenario.group === 'texas-holdem'));
      assert.deepEqual(
        [...app, ...texas, ...zhajinhua].map(scenario => scenario.label).sort(),
        all.map(scenario => scenario.label).sort(),
      );
      const screenshots = (scenarios: typeof all) => scenarios.reduce(
        (sum, scenario) => sum + (scenario.snapshotStates?.length || 1), 0,
      );
      assert.equal(screenshots(texas), 564);
      assert.equal(screenshots(app), scope === 'core' ? 492 : 678);
      assert.equal(screenshots(zhajinhua), 156);
      assert.equal(screenshots(app) + screenshots(texas) + screenshots(zhajinhua), screenshots(all));
    });
  }

  test('game suites use real house and building APIs rather than App placeholder fixtures', async () => {
    for (const suite of ['app', 'texas', 'zhajinhua'] as const) {
      const routes: RegExp[] = [];
      const context = {
        addInitScript: async () => {},
        route: async (matcher: unknown) => { if (matcher instanceof RegExp) routes.push(matcher); },
      } as unknown as BrowserContext;
      const scenario = buildScenarios({ VISUAL_SUITE: suite, VISUAL_LOCALES: 'zh-Hans' })
        .find(item => item.signIn)!;
      await setupContextForScenario(context, scenario, undefined, { useMitmproxy: suite !== 'app' });
      for (const path of ['/v10/house/user/user-id', '/v2/building/rooms']) {
        assert.equal(routes.some(matcher => matcher.test(`https://api.shafayouxi.org${path}`)),
          suite === 'app', `${suite}: ${path}`);
      }
    }
  });

  test('invalid suite fails instead of silently selecting the wrong tests', () => {
    assert.equal(getVisualSuite({}), 'all');
    assert.throws(() => buildScenarios({ VISUAL_SUITE: 'typo' }), /VISUAL_SUITE/);
  });

  test('texas has its own default account and explicit credentials remain supported', () => {
    const app = getVisualTestAccount({ VISUAL_SUITE: 'app' });
    const texas = getVisualTestAccount({ VISUAL_SUITE: 'texas' });
    const zhajinhua = getVisualTestAccount({ VISUAL_SUITE: 'zhajinhua' });
    assert.equal(new Set([app.username, texas.username, zhajinhua.username]).size, 3);
    assert.equal(getVisualTestAccount({}).username, app.username);
    assert.deepEqual(getVisualTestAccount({
      VISUAL_SUITE: 'texas', VISUAL_USERNAME: 'custom', VISUAL_PASSWORD: 'password',
    }), { username: 'custom', password: 'password' });
  });

  test('balance updates only accept the fixed account selected for this run', () => {
    assert.ok(canTopUpVisualAccount('laiwanvisualzjh01', { VISUAL_SUITE: 'zhajinhua' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisualzjh01', { VISUAL_SUITE: 'texas' }));
    assert.ok(canTopUpVisualAccount('laiwanvisual01', {}));
    assert.ok(canTopUpVisualAccount('laiwanvisualtexas01', { VISUAL_SUITE: 'texas' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisual01', { VISUAL_SUITE: 'texas' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisualtexas01', {}));
    assert.ok(!canTopUpVisualAccount('custom', { VISUAL_USERNAME: 'custom' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisual01', { VISUAL_USERNAME: 'custom' }));
  });
});
