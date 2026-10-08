import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildScenarios } from './scenarios';
import { canTopUpVisualAccount, getVisualTestAccount } from './test-account';
import { getVisualSuite } from './visual-suite';

describe('visual suite selection and account isolation', () => {
  for (const scope of ['core', 'full']) {
    test(`${scope}: app and texas partition all locales without losing or duplicating scenarios`, () => {
      const env = { VISUAL_LOCALES: 'all', VISUAL_SCOPE: scope };
      const all = buildScenarios(env);
      const app = buildScenarios({ ...env, VISUAL_SUITE: 'app' });
      const texas = buildScenarios({ ...env, VISUAL_SUITE: 'texas' });
      assert.equal(texas.length, 30);
      assert.equal(app.length, (scope === 'core' ? 40 : 102) * 3);
      assert.ok(app.every(scenario => scenario.group !== 'texas-holdem'));
      assert.ok(texas.every(scenario => scenario.group === 'texas-holdem'));
      assert.deepEqual(
        [...app, ...texas].map(scenario => scenario.label).sort(),
        all.map(scenario => scenario.label).sort(),
      );
      const screenshots = (scenarios: typeof all) => scenarios.reduce(
        (sum, scenario) => sum + (scenario.snapshotStates?.length || 1), 0,
      );
      assert.equal(screenshots(texas), 348);
      assert.equal(screenshots(app), scope === 'core' ? 120 : 306);
      assert.equal(screenshots(app) + screenshots(texas), screenshots(all));
    });
  }

  test('invalid suite fails instead of silently selecting the wrong tests', () => {
    assert.equal(getVisualSuite({}), 'all');
    assert.throws(() => buildScenarios({ VISUAL_SUITE: 'typo' }), /VISUAL_SUITE/);
  });

  test('texas has its own default account and explicit credentials remain supported', () => {
    const app = getVisualTestAccount({ VISUAL_SUITE: 'app' });
    const texas = getVisualTestAccount({ VISUAL_SUITE: 'texas' });
    assert.notEqual(app.username, texas.username);
    assert.equal(getVisualTestAccount({}).username, app.username);
    assert.deepEqual(getVisualTestAccount({
      VISUAL_SUITE: 'texas', VISUAL_USERNAME: 'custom', VISUAL_PASSWORD: 'password',
    }), { username: 'custom', password: 'password' });
  });

  test('balance updates only accept the fixed account selected for this run', () => {
    assert.ok(canTopUpVisualAccount('laiwanvisual01', {}));
    assert.ok(canTopUpVisualAccount('laiwanvisualtexas01', { VISUAL_SUITE: 'texas' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisual01', { VISUAL_SUITE: 'texas' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisualtexas01', {}));
    assert.ok(!canTopUpVisualAccount('custom', { VISUAL_USERNAME: 'custom' }));
    assert.ok(!canTopUpVisualAccount('laiwanvisual01', { VISUAL_USERNAME: 'custom' }));
  });
});
