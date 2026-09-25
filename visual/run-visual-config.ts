export type VisualRunAction = 'test' | 'reference' | 'approve';

export type VisualShardConfig = {
  countEnv: 'VISUAL_TEST_SHARDS' | 'VISUAL_REFERENCE_SHARDS';
  count: number;
  start: number;
};

const MAX_SHARD_COUNT = 80;
export const DEFAULT_MAX_SCENARIOS_PER_SHARD = 3;

/**
 * 所有视觉场景都按小分片执行，调用方可在分片边界更新短时登录态。
 * 默认每批最多三个场景；显式分片数仍用于诊断或 reference 断点续跑。
 */
export function getVisualShardConfig(
  action: VisualRunAction,
  scenarioCount: number,
  env: NodeJS.ProcessEnv = process.env,
): VisualShardConfig {
  if (!Number.isInteger(scenarioCount) || scenarioCount < 0) {
    throw new Error(`scenarioCount 必须是非负整数，当前值: ${String(scenarioCount)}`);
  }

  const countEnv = action === 'reference' ? 'VISUAL_REFERENCE_SHARDS' : 'VISUAL_TEST_SHARDS';
  const configuredCount = env[countEnv];
  const requestedCount = Number(
    configuredCount || Math.max(1, Math.ceil(scenarioCount / DEFAULT_MAX_SCENARIOS_PER_SHARD)),
  );
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_SHARD_COUNT) {
    throw new Error(
      `${countEnv} 必须是 1 到 ${MAX_SHARD_COUNT} 的整数，当前值: ${String(env[countEnv])}`,
    );
  }
  // Playwright 默认把“没有匹配测试”视为失败。分片数不能超过选中场景数，
  // 否则过滤或冒烟轮次末尾会产生必然为空的 shard。
  const count = Math.min(requestedCount, Math.max(1, scenarioCount));

  const start = action === 'reference' ? Number(env.VISUAL_REFERENCE_START_SHARD || 1) : 1;
  if (!Number.isInteger(start) || start < 1 || start > count) {
    throw new Error(
      `VISUAL_REFERENCE_START_SHARD 必须是 1 到 ${count} 的整数，当前值: ${String(
        env.VISUAL_REFERENCE_START_SHARD,
      )}`,
    );
  }

  return { countEnv, count, start };
}
