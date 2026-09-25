import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getVisualShardConfig } from './run-visual-config';

describe('visual run shard config', () => {
  test('unfiltered test runs are split into short renewable-auth batches', () => {
    assert.deepEqual(getVisualShardConfig('test', 84, {}), {
      countEnv: 'VISUAL_TEST_SHARDS',
      count: 28,
      start: 1,
    });
  });

  test('test shard count can be configured independently', () => {
    assert.deepEqual(getVisualShardConfig('test', 84, { VISUAL_TEST_SHARDS: '14' }), {
      countEnv: 'VISUAL_TEST_SHARDS',
      count: 14,
      start: 1,
    });
  });

  test('reference keeps its resumable shard setting', () => {
    assert.deepEqual(
      getVisualShardConfig('reference', 84, {
        VISUAL_REFERENCE_SHARDS: '20',
        VISUAL_REFERENCE_START_SHARD: '6',
      }),
      { countEnv: 'VISUAL_REFERENCE_SHARDS', count: 20, start: 6 },
    );
  });

  test('filter, core scope and approve defaults keep each renewable-auth batch at three scenarios', () => {
    const publicRuns = [
      getVisualShardConfig('test', 67, {}),
      getVisualShardConfig('test', 22, { VISUAL_SCOPE: 'core' }),
      getVisualShardConfig('approve', 84, {}),
    ];

    assert.deepEqual(
      publicRuns.map(({ count }) => count),
      [23, 8, 28],
    );
    assert.ok(Math.ceil(67 / publicRuns[0].count) <= 3);
    assert.ok(Math.ceil(22 / publicRuns[1].count) <= 3);
    assert.ok(Math.ceil(84 / publicRuns[2].count) <= 3);
  });

  test('filtered runs do not create empty shards', () => {
    assert.equal(getVisualShardConfig('test', 1, {}).count, 1);
    assert.equal(getVisualShardConfig('test', 2, { VISUAL_TEST_SHARDS: '28' }).count, 2);
  });

  test('invalid shard counts fail before starting Playwright', () => {
    assert.throws(
      () => getVisualShardConfig('test', 84, { VISUAL_TEST_SHARDS: '0' }),
      /VISUAL_TEST_SHARDS 必须是 1 到 80 的整数/,
    );
  });
});
