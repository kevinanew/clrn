import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildScenarios, type VisualScenario } from './scenarios';

test('every active scenario has one baseline beside its feature spec', () => {
  const scenarios = buildScenarios({ VISUAL_LOCALES: 'all' });
  const expected = new Set<string>();

  for (const scenario of scenarios) {
    const directory = path.join(__dirname, 'cases', scenario.group);
    assert.ok(existsSync(path.join(directory, `${scenario.group}.spec.ts`)), scenario.group);
    for (const label of snapshotLabels(scenario)) {
      const png = path.join(directory, 'snapshots', `${label.replace(/_/g, '-')}.png`);
      assert.ok(existsSync(png), label);
      expected.add(png);
    }
  }

  const actual = readdirSync(path.join(__dirname, 'cases'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== '_shared')
    .flatMap(entry => readdirSync(path.join(__dirname, 'cases', entry.name, 'snapshots'))
      .filter(file => file.endsWith('.png'))
      .map(file => path.join(__dirname, 'cases', entry.name, 'snapshots', file)));
  assert.equal(expected.size, scenarios.reduce((sum, scenario) => sum + (scenario.snapshotStates?.length ?? 1), 0));
  assert.deepEqual(new Set(actual), expected);
});

/**
 * 返回场景全部状态的基准标签，无状态时使用场景自身。
 * @param scenario - 当前场景。
 */
function snapshotLabels(scenario: VisualScenario): string[] {
  return scenario.snapshotStates?.map(state => `${scenario.label}_${state}`) ?? [scenario.label];
}
