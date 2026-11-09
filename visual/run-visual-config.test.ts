import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { exactScenarioGrep, getVisualShardConfig, selectScenariosByLabel } from './run-visual-config';

describe('visual run shard config', /** 核对视觉运行的场景筛选与分片配置。 */ () => {
  test('filter and Playwright grep select the same labels despite feature paths', /** 验证场景标签筛选与 Playwright grep 在不同功能路径下仍选择相同案例。 */ () => {
    const scenarios = [
      { label: 'zh-Hans_mobile_signed_in_mall' },
      { label: 'zh-Hans_mobile_signed_in_account_security' },
      { label: 'zh-Hans_mobile_guest_me' },
    ];
    const selected = selectScenariosByLabel(scenarios, 'account');
    assert.deepEqual(selected.map(/** 提取筛选后的场景标签，核对标签匹配结果。
 * @param scenario - 当前测试场景配置。 */ scenario => scenario.label), [
      'zh-Hans_mobile_signed_in_account_security',
    ]);

    const grep = new RegExp(exactScenarioGrep(selected.map(/** 提取场景标签，验证精确筛选正则的匹配边界。
 * @param scenario - 当前测试场景配置。 */ scenario => scenario.label)));
    assert.ok(grep.test('cases/account/account.spec.ts zh-Hans_mobile_signed_in_account_security'));
    assert.ok(!grep.test('cases/account/account.spec.ts zh-Hans_mobile_guest_me'));
    assert.ok(!grep.test('cases/wallet/wallet.spec.ts zh-Hans_mobile_signed_in_mall'));
    assert.ok(!new RegExp(exactScenarioGrep([])).test('cases/account/account.spec.ts zh-Hans_mobile_guest_me'));
    assert.throws(/** 使用无效正则筛选场景，验证过滤表达式错误会被报告。 */ () => selectScenariosByLabel(scenarios, '['), /VISUAL_FILTER/);
  });

  test('unfiltered test runs are split into short renewable-auth batches', /** 验证未筛选的测试会拆成可续期认证的短批次。 */ () => {
    assert.deepEqual(getVisualShardConfig('test', 84, {}), {
      countEnv: 'VISUAL_TEST_SHARDS',
      count: 28,
      start: 1,
    });
  });

  test('test shard count can be configured independently', /** 验证测试分片数量可以独立配置。 */ () => {
    assert.deepEqual(getVisualShardConfig('test', 84, { VISUAL_TEST_SHARDS: '14' }), {
      countEnv: 'VISUAL_TEST_SHARDS',
      count: 14,
      start: 1,
    });
  });

  test('reference keeps its resumable shard setting', /** 验证参考截图保留可恢复的分片设置。 */ () => {
    assert.deepEqual(
      getVisualShardConfig('reference', 84, {
        VISUAL_REFERENCE_SHARDS: '20',
        VISUAL_REFERENCE_START_SHARD: '6',
      }),
      { countEnv: 'VISUAL_REFERENCE_SHARDS', count: 20, start: 6 },
    );
  });

  test('filter, core scope and reference defaults keep each renewable-auth batch at three scenarios', /** 验证筛选、核心范围与参考截图默认每批最多三个场景。 */ () => {
    const publicRuns = [
      getVisualShardConfig('test', 67, {}),
      getVisualShardConfig('test', 22, { VISUAL_SCOPE: 'core' }),
      getVisualShardConfig('reference', 84, {}),
    ];

    assert.deepEqual(
      publicRuns.map(/** 提取各批次用例数，核对公开场景的分批安排。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ count }) => count),
      [23, 8, 28],
    );
    assert.ok(Math.ceil(67 / publicRuns[0].count) <= 3);
    assert.ok(Math.ceil(22 / publicRuns[1].count) <= 3);
    assert.ok(Math.ceil(84 / publicRuns[2].count) <= 3);
  });

  test('filtered runs do not create empty shards', /** 验证筛选运行不会生成空分片。 */ () => {
    assert.equal(getVisualShardConfig('test', 1, {}).count, 1);
    assert.equal(getVisualShardConfig('test', 2, { VISUAL_TEST_SHARDS: '28' }).count, 2);
  });

  test('invalid shard counts fail before starting Playwright', /** 验证无效分片数量在 Playwright 启动前就会失败。 */ () => {
    assert.throws(
      /** 使用零分片数构造分片配置，验证运行前拒绝无效配置。 */ () => getVisualShardConfig('test', 84, { VISUAL_TEST_SHARDS: '0' }),
      /VISUAL_TEST_SHARDS 必须是 1 到 80 的整数/,
    );
  });
});
