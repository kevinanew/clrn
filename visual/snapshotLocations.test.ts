import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildScenarios } from './scenarios';

test('every active scenario has one baseline beside its feature spec', /** 验证每个活动场景都有位于所属功能目录的截图基准。 */ () => {
  const scenarios = buildScenarios({ VISUAL_LOCALES: 'all' });
  const expected = new Set<string>();

  for (const scenario of scenarios) {
    const directory = path.join(__dirname, 'cases', scenario.group);
    assert.ok(existsSync(path.join(directory, `${scenario.group}.spec.ts`)), scenario.group);
    for (const label of scenario.snapshotStates?.map(/** 将当前条目映射为`${scenario.label}_${state}`。
 * @param state - 当前操作使用的 state。 */ state => `${scenario.label}_${state}`) ?? [scenario.label]) {
      const png = path.join(directory, 'snapshots', `${label.replace(/_/g, '-')}.png`);
      assert.ok(existsSync(png), label);
      expected.add(png);
    }
  }

  const actual = readdirSync(path.join(__dirname, 'cases'), { withFileTypes: true })
    .filter(/** 仅保留满足以下条件的条目：`entry.isDirectory() && entry.name !== '_shared'`。
 * @param entry - 当前处理的记录条目。 */ entry => entry.isDirectory() && entry.name !== '_shared')
    .flatMap(/** 收集每个视觉套件快照目录中的 PNG 路径。
 * @param entry - 当前处理的记录条目。 */ entry => readdirSync(path.join(__dirname, 'cases', entry.name, 'snapshots'))
      .filter(/** 仅保留满足以下条件的条目：`file.endsWith('.png')`。
 * @param file - 当前源码或资源路径。 */ file => file.endsWith('.png'))
      .map(/** 将当前条目映射为`path.join(__dirname, 'cases', entry.name, 'snapshots', file)`。
 * @param file - 当前源码或资源路径。 */ file => path.join(__dirname, 'cases', entry.name, 'snapshots', file)));
  assert.equal(expected.size, scenarios.reduce(/** 按每个场景包含的快照状态累计预期基准数量。
 * @param sum - 当前操作使用的 sum。
 * @param scenario - 当前测试场景配置。 */ (sum, scenario) => sum + (scenario.snapshotStates?.length ?? 1), 0));
  assert.deepEqual(new Set(actual), expected);
});
