export const VISUAL_SNAPSHOT_UPDATES = { test: 'none', reference: 'all' } as const;
export type VisualRunAction = keyof typeof VISUAL_SNAPSHOT_UPDATES;

export type VisualShardConfig = {
  countEnv: 'VISUAL_TEST_SHARDS' | 'VISUAL_REFERENCE_SHARDS';
  count: number;
  start: number;
};

const MAX_SHARD_COUNT = 80;
export const DEFAULT_MAX_SCENARIOS_PER_SHARD = 3;

/**
 * VISUAL_FILTER 只匹配场景 label，不让 spec 文件名影响登录态和分片规划。
 * @param scenarios - 当前候选视觉场景清单。
 * @param filter - 匹配场景标签的可选正则表达式。
 */
export function selectScenariosByLabel<T extends { label: string }>(
  scenarios: T[],
  filter: string | undefined,
): T[] {
  if (!filter) return scenarios;
  let matcher: RegExp;
  try {
    matcher = new RegExp(filter);
  } catch {
    throw new Error(`VISUAL_FILTER 不是有效正则表达式: ${filter}`);
  }
  return scenarios.filter(scenario => matcher.test(scenario.label));
}

/**
 * 将已选 label 转成 Playwright 的精确 grep；它匹配的完整标题还包含 spec 路径。
 * @param labels - 已选场景的完整标签。
 */
export function exactScenarioGrep(labels: string[]): string {
  if (labels.length === 0) return '(?!)';
  const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `(?:^|\\s)(?:${escaped.join('|')})$`;
}

/**
 * 所有视觉场景都按小分片执行，调用方可在分片边界更新短时登录态。
 * 默认每批最多三个场景；显式分片数仍用于诊断或 reference 断点续跑。
 * @param action - 当前操作：比较或生成候选基准。
 * @param scenarioCount - 筛选后待运行的场景数量。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getVisualShardConfig(
  action: VisualRunAction,
  scenarioCount: number,
  env: NodeJS.ProcessEnv = process.env,
): VisualShardConfig {
  assertScenarioCount(scenarioCount);
  const countEnv = action === 'reference' ? 'VISUAL_REFERENCE_SHARDS' : 'VISUAL_TEST_SHARDS';
  const requestedCount = requestedShardCount(env[countEnv], scenarioCount);
  assertShardRange(requestedCount, MAX_SHARD_COUNT,
    `${countEnv} 必须是 1 到 ${MAX_SHARD_COUNT} 的整数，当前值: ${String(env[countEnv])}`);
  // 避免生成空 shard，同时保留空场景时至少一片的原有约定。
  const count = Math.min(requestedCount, Math.max(1, scenarioCount));
  const start = referenceStartShard(action, env);
  assertShardRange(start, count,
    `VISUAL_REFERENCE_START_SHARD 必须是 1 到 ${count} 的整数，当前值: ${String(env.VISUAL_REFERENCE_START_SHARD)}`);
  return { countEnv, count, start };
}

/**
 * 拒绝无效场景数量，零场景仍由运行入口处理。
 * @param count - 待运行场景数量。
 */
function assertScenarioCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`scenarioCount 必须是非负整数，当前值: ${String(count)}`);
  }
}

/**
 * 沿用空字符串使用自动分片数的约定。
 * @param configured - 显式分片数。
 * @param scenarioCount - 当前场景数量。
 */
function requestedShardCount(configured: string | undefined, scenarioCount: number): number {
  return Number(configured || Math.max(1, Math.ceil(scenarioCount / DEFAULT_MAX_SCENARIOS_PER_SHARD)));
}

/**
 * 普通比较始终从第一片执行，采集允许断点续跑。
 * @param action - 运行操作。
 * @param env - 当前环境。
 */
function referenceStartShard(action: VisualRunAction, env: NodeJS.ProcessEnv): number {
  if (action !== 'reference') return 1;
  return Number(env.VISUAL_REFERENCE_START_SHARD || 1);
}

/**
 * 校验整数及闭区间，分别保留调用方的错误诊断。
 * @param value - 待校验的片号或片数。
 * @param maximum - 允许的最大值。
 * @param message - 对应环境配置的诊断。
 */
function assertShardRange(value: number, maximum: number, message: string): void {
  if (!Number.isInteger(value)) throw new Error(message);
  assertShardBounds(value, maximum, message);
}

/**
 * 检查整数片号的上下界。
 * @param value - 已确认的整数。
 * @param maximum - 允许的最大值。
 * @param message - 配置诊断。
 */
function assertShardBounds(value: number, maximum: number, message: string): void {
  if (value < 1 || value > maximum) throw new Error(message);
}
