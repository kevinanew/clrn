import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScenarios, CORE_PAGE_LABELS } from '../../scenarios';
import { LEGACY_STATES, V2_STATES } from './scenarios';

for (const scope of ['full', 'core']) {
  for (const version of ['legacy', 'v2']) {
    test(`战绩 ${scope}/${version} 覆盖三语言、两视口及完整状态`, /** 核对版本矩阵与每个场景的截图状态。 */ () => {
      const scenarios = buildScenarios({ VISUAL_LOCALES: 'all', VISUAL_SCOPE: scope })
        .filter(/** 仅选择战绩场景。
         * @param item - 当前视觉场景。 */ item => item.group === 'game-record');
      assert.equal(scenarios.length, 12);
      const selected = scenarios.filter(/** 按版本选择场景。
       * @param item - 当前视觉场景。 */ item => item.pageLabel.endsWith(version));
      assert.equal(selected.length, 6);
      assert.deepEqual(new Set(selected.map(/** 生成语言与视口标识。
       * @param item - 当前视觉场景。 */ item => `${item.locale}/${item.viewport.label}`)),
        new Set(['zh-Hans/desktop', 'zh-Hans/mobile', 'zh-Hant/desktop', 'zh-Hant/mobile', 'en/desktop', 'en/mobile']));
      for (const scenario of selected) {
        assert.ok(CORE_PAGE_LABELS.has(scenario.pageLabel));
        assert.equal(scenario.signIn, true);
        assert.deepEqual(scenario.snapshotStates, version === 'legacy' ? [...LEGACY_STATES] : [...V2_STATES]);
        assert.equal(new Set(scenario.snapshotStates).size, scenario.snapshotStates!.length);
      }
    });
  }
}
