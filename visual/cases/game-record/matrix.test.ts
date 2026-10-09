import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenarios, CORE_PAGE_LABELS } from '../../scenarios';
import { LEGACY_STATES, V2_STATES } from './scenarios';

test('战绩新旧版在全量和核心矩阵均覆盖三语言、两视口及完整状态', () => {
  for (const scope of ['full', 'core']) {
    const scenarios = buildScenarios({ VISUAL_LOCALES: 'all', VISUAL_SCOPE: scope })
      .filter(item => item.group === 'game-record');
    assert.equal(scenarios.length, 12);
    for (const version of ['legacy', 'v2']) {
      const selected = scenarios.filter(item => item.pageLabel.endsWith(version));
      assert.equal(selected.length, 6);
      assert.deepEqual(new Set(selected.map(item => `${item.locale}/${item.viewport.label}`)),
        new Set(['zh-Hans/desktop', 'zh-Hans/mobile', 'zh-Hant/desktop', 'zh-Hant/mobile', 'en/desktop', 'en/mobile']));
      for (const scenario of selected) {
        assert.ok(CORE_PAGE_LABELS.has(scenario.pageLabel));
        assert.equal(scenario.signIn, true);
        assert.deepEqual(scenario.snapshotStates, version === 'legacy' ? [...LEGACY_STATES] : [...V2_STATES]);
        assert.equal(new Set(scenario.snapshotStates).size, scenario.snapshotStates?.length);
      }
    }
  }
});
