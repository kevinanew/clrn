/** 只使用历史结果安排顺序；每轮完整计划均来自当前配置。 */
import { createHash } from 'node:crypto';

/**
 * 为分片生成与账号轮转、任务显示名称无关的稳定标识。
 * @param mode - 工作流套件。
 * @param item - 当前矩阵条目。
 */
export function shardId(mode, item) {
  return `${mode}/${item.suite}/${item.locale || item.part}`;
}

/**
 * 比较配置内容，而不是提交编号；业务修复仍可复用执行顺序。
 * @param value - 当前计划和调度配置的规范序列化内容。
 */
export function configurationHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * 拒绝重复、遗漏、未知分片和重叠阶段。
 * @param plan - 包含完整分片及两个阶段的计划。
 */
export function validatePartition(plan) {
  const combined = [...plan.priority, ...plan.remaining];
  if (!plan.ids.length || new Set(plan.ids).size !== plan.ids.length
    || combined.length !== plan.ids.length || new Set(combined).size !== combined.length
    || combined.some(id => !plan.ids.includes(id))) {
    throw new Error('分片计划不完整或阶段发生重叠');
  }
}

/**
 * 从执行任务标识读取真实结论，忽略同名的轻量门禁。
 * @param jobs - GitHub 返回的本次 run 最新任务结果。
 * @param ids - 历史完整计划的标识。
 */
function shardResults(jobs, ids) {
  const results = new Map();
  for (const job of jobs) {
    const id = job.name.match(/\[ci:([^\]]+)\]$/)?.[1];
    if (!id || !id.startsWith(`${ids[0].split('/')[0]}/`)) continue;
    if (!ids.includes(id)) throw new Error('历史分片无法可靠映射');
    recordLatest(results, id, job);
  }
  return new Map([...results].map(([id, job]) => [id, job.status === 'completed' ? job.conclusion : 'incomplete']));
}

/**
 * 原生只重跑失败任务时，仍保留同一提交较早 attempt 未重跑的分片结果。
 * @param results - 各分片最新执行记录。
 * @param id - 稳定分片标识。
 * @param job - API 任务记录。
 */
function recordLatest(results, id, job) {
  const previous = results.get(id);
  if (!Number.isInteger(job.run_attempt) || job.run_attempt < 1 || previous?.run_attempt === job.run_attempt) {
    throw new Error('历史分片 attempt 缺失或重复');
  }
  if (!previous || previous.run_attempt < job.run_attempt) results.set(id, job);
}

/**
 * 校验历史来源与完整计划；缺失任务仅允许来自被失败优先阶段阻止的剩余阶段。
 * @param current - 当前计划。
 * @param history - 历史计划及 API 实测结果。
 */
function validateHistory(current, history) {
  const previous = history.plan;
  validatePartition(previous);
  if (previous.schema !== 1 || previous.fingerprint !== current.fingerprint
    || JSON.stringify(previous.context) !== JSON.stringify(current.context)
    || JSON.stringify(previous.ids) !== JSON.stringify(current.ids)
    || String(previous.run_id) !== String(history.run.id) || previous.sha !== history.run.head_sha) {
    throw new Error('历史来源或测试配置不兼容');
  }
}

/**
 * 保留失败优先阻止执行的剩余计划，防止连续修复后覆盖缩小。
 * @param current - 当前计划。
 * @param history - 历史计划及真实任务。
 */
function failedIds(current, history) {
  validateHistory(current, history);
  const previous = history.plan;
  const results = shardResults(history.jobs, previous.ids);
  const blocked = previous.priority.some(id => results.get(id) !== 'success');
  const failed = previous.ids.filter(id => results.has(id) && results.get(id) !== 'success'
    && !(blocked && previous.remaining.includes(id) && results.get(id) === 'skipped'));
  for (const id of previous.ids) {
    if (results.has(id)) continue;
    if (!blocked || !previous.remaining.includes(id)) throw new Error('历史缺少应执行分片');
  }
  // 全部优先任务缺失时不能推断真正失败项，回退完整计划。
  if (blocked && !failed.length) throw new Error('历史没有可验证的失败分片');
  return failed;
}

/**
 * 安排失败优先和剩余阶段；任何不确定性都回退全量。
 * @param current - 当前完整计划。
 * @param history - 可选历史证据。
 * @param reason - 未提供历史的原因。
 */
export function schedulePlan(current, history, reason = '没有有效历史，执行全量') {
  let priority = [], source = null;
  if (history) {
    try {
      priority = failedIds(current, history);
      source = history.run.html_url;
      reason = priority.length ? '先验证历史未成功分片' : '历史全部成功，执行当前全量';
    } catch (error) { reason = `${error.message}，回退全量`; }
  }
  const remaining = current.ids.filter(id => !priority.includes(id));
  const plan = { ...current, priority, remaining, source, reason };
  validatePartition(plan);
  return plan;
}

/**
 * 验证两个阶段结论；空阶段只能是 skipped，有任务的阶段必须成功。
 * @param needs - GitHub 的直接依赖结果及规划输出。
 */
export function assertFullSuccess(needs) {
  if (needs.accounts.result !== 'success') throw new Error('完整计划或构建准备失败');
  const outputs = needs.accounts.outputs;
  const full = JSON.parse(outputs.matrix).include;
  const priority = JSON.parse(outputs.priority).include;
  const remaining = JSON.parse(outputs.remaining).include;
  const ids = full.map(item => JSON.stringify(item));
  validatePartition({ ids, priority: priority.map(item => JSON.stringify(item)),
    remaining: remaining.map(item => JSON.stringify(item)) });
  for (const [phase, items] of [['priority', priority], ['remaining', remaining]]) {
    if (String(items.length) !== outputs[`${phase}_count`]) throw new Error('阶段数量不一致');
    const expected = items.length ? 'success' : 'skipped';
    if (needs[phase].result !== expected) throw new Error(`${phase}: ${needs[phase].result}，要求 ${expected}`);
  }
}

/**
 * 输出可审查的来源、完整阶段清单及当前结果。
 * @param plan - 调度计划。
 */
export function planSummary(plan) {
  return `### CI 失败优先调度\n\n${plan.reason}\n\n历史来源：${plan.source || '无'}\n\n`
    + `当前提交：${plan.sha}\n\n优先（${plan.priority.length}）：${plan.priority.join(', ') || '无'}\n\n`
    + `剩余（${plan.remaining.length}）：${plan.remaining.join(', ') || '无'}\n\n`
    + '历史通过结果不会替代当前提交的检查。\n';
}
