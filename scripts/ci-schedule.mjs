/** GitHub Actions 两阶段调度入口；账号仍由现有账号池按完整计划分配。 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { visualAccountMatrix, animationAccountMatrix } from './ci-accounts.mjs';
import { readDeploymentRecord, verifyDeploymentArtifact } from './staging-deployment.mjs';
import { githubReader, loadHistory } from './ci-schedule-api.mjs';
import { assertFullSuccess, commitIdentity, configurationHash, planSummary, schedulePlan, shardId } from './ci-schedule-plan.mjs';

/**
 * 指纹覆盖分片定义、调度实现、实际执行配置及手动参数，排除只改变顺序的开关。
 * @param mode - 矩阵工作流。
 * @param options - 本轮 workflow inputs。
 */
function compatibility(mode, options) {
  const files = ['scripts/ci-accounts.mjs', 'scripts/ci-test-accounts.json',
    'scripts/ci-schedule.mjs', 'scripts/ci-schedule-plan.mjs', 'scripts/ci-schedule-api.mjs',
    'visual/visual-suite.ts', 'visual/run-visual-config.ts', 'visual/playwright.config.ts',
    'visual/animations/playwright.config.ts', 'visual/package.json', 'visual/pnpm-lock.yaml',
    `.github/workflows/${mode}.yml`, `.github/workflows/ci-${mode}-shards.yml`];
  const selected = mode === 'visual'
    ? { suite: options.suite || 'all', mode: options.mode || 'compare', filter: options.filter || '' }
    : { suite: options.suite || 'all', update_snapshots: options.update_snapshots === true,
      card_sprite_control: options.card_sprite_control === true };
  return configurationHash({ selected, files: files.map(file => readFileSync(file, 'utf8')) });
}

/**
 * 保存摘要，便于检查失败及空阶段。
 * @param text - Markdown 摘要内容。
 */
function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

/**
 * 固定并核验两阶段共用的外部应用构建。
 * @param options - 本轮工作流的输入选项。
 */
async function fixedBuild(options) {
  const content = options.release_record || readFileSync('deployments/staging.json', 'utf8');
  const commit = readDeploymentRecord(content);
  if (options.expected_application_commit && options.expected_application_commit !== commit) {
    throw new Error('本轮预期应用提交与固定 Release 记录不一致');
  }
  await verifyDeploymentArtifact({ content, token: process.env.GITHUB_TOKEN });
  return { content, commit };
}

/**
 * 历史读取故障仅影响顺序，不阻止当前全量检查。
 * @param mode - 工作流套件。
 * @param options - 输入选项。
 */
async function historicalEvidence(mode, options) {
  if (options.full_run === true) return { reason: '手动强制全量' };
  try {
    const history = await loadHistory({ read: githubReader({ repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN }), runId: process.env.GITHUB_RUN_ID, mode });
    return { history, reason: '没有历史记录，执行全量' };
  } catch (error) { return { reason: `${error.message}，回退全量` }; }
}

/**
 * 固定当前构建并从当前矩阵生成两个互斥阶段。
 * @param mode - visual 或 animations。
 */
async function plan(mode) {
  const env = process.env;
  const options = JSON.parse(env.CI_SCHEDULE_OPTIONS || '{}');
  const suite = options.suite || 'all';
  const matrix = mode === 'visual' ? visualAccountMatrix(env.GITHUB_RUN_ID, suite, true)
    : animationAccountMatrix(env.GITHUB_RUN_ID, suite);
  const { content, commit } = await fixedBuild(options);
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const current = { schema: 1, mode, run_id: env.GITHUB_RUN_ID, ...commitIdentity(env, event),
    context: { repository: env.GITHUB_REPOSITORY, workflow: env.GITHUB_WORKFLOW,
      ref: env.GITHUB_REF, event: env.GITHUB_EVENT_NAME, pr: event.number || null },
    fingerprint: compatibility(mode, options), ids: matrix.include.map(item => shardId(mode, item)) };
  const { history, reason } = await historicalEvidence(mode, options);
  const result = schedulePlan(current, history, reason);
  writeFileSync('ci-plan.json', JSON.stringify(result));
  const outputs = { matrix, release_record: JSON.parse(content), application_commit: commit };
  for (const phase of ['priority', 'remaining']) {
    outputs[phase] = { include: matrix.include.filter(item => result[phase].includes(shardId(mode, item))) };
    outputs[`${phase}_count`] = result[phase].length;
  }
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  }
  summary(planSummary(result) + `\n固定应用构建：${commit}\n`);
}

/** 当前提交全量检查必须成功，任何未执行或失败阶段均阻止门禁。 */
function gate() {
  const needs = JSON.parse(process.env.CI_SCHEDULE_NEEDS);
  summary(`### 当前提交完整回归门禁\n\n规划：${needs.accounts.result}\n\n`
    + `优先阶段：${needs.priority.result}（${needs.accounts.outputs.priority_count || '?'} 项）\n\n`
    + `剩余阶段：${needs.remaining.result}（${needs.accounts.outputs.remaining_count || '?'} 项）\n`);
  assertFullSuccess(needs);
}

try {
  const [command, mode] = process.argv.slice(2);
  if (!['visual', 'animations'].includes(mode)) throw new Error('不支持的矩阵工作流');
  if (command === 'plan') await plan(mode);
  else if (command === 'gate') gate();
  else throw new Error('用法：ci-schedule.mjs plan|gate visual|animations');
} catch (error) { console.error(error.message); process.exitCode = 1; }
