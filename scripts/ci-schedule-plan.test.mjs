/** 验证新提交上执行完整覆盖、连续失败和完整门禁。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { animationAccountMatrix, visualAccountMatrix } from './ci-accounts.mjs';
import { assertFullSuccess, configurationHash, schedulePlan, shardId } from './ci-schedule-plan.mjs';

/**
 * 使用真实的九分片配置并模拟不依赖历史通过结果的新提交。
 * @param mode - 工作流套件。
 */
function currentPlan(mode = 'visual') {
  const matrix = mode === 'visual' ? visualAccountMatrix('100', 'all', true) : animationAccountMatrix('100');
  return { schema: 1, mode, run_id: '100', sha: 'current-sha', fingerprint: configurationHash(mode),
    context: { repository: 'owner/repo', workflow: mode, ref: 'refs/pull/97/merge', event: 'pull_request', pr: 97 },
    ids: matrix.include.map(item => shardId(mode, item)) };
}

/**
 * 建立有稳定执行标识的 API 任务结果。
 * @param id - 分片标识。
 * @param conclusion - GitHub 结论。
 */
function job(id, conclusion = 'success') {
  return { name: `阶段 / 测试 [ci:${id}]`, status: 'completed', conclusion, run_attempt: 1 };
}

/**
 * 将一个计划的实际执行结果保存为下一轮历史。
 * @param plan - 历史完整计划。
 * @param jobs - 历史实测任务。
 */
function evidence(plan, jobs) {
  return { plan, jobs, run: { id: plan.run_id, head_sha: plan.sha, html_url: 'https://github.com/owner/repo/actions/runs/1' } };
}

test('无历史、强制全量、全成功历史均重新执行当前全部 9/7 分片', () => {
  for (const mode of ['visual', 'animations']) {
    const current = currentPlan(mode), full = schedulePlan(current);
    assert.equal(full.ids.length, mode === 'visual' ? 9 : 7);
    assert.deepEqual(full.remaining, current.ids);
    const next = schedulePlan(current, evidence(full, full.ids.map(id => job(id))));
    assert.deepEqual(next.priority, []);
    assert.deepEqual(next.remaining, current.ids);
  }
});

test('连续三轮优先失败保留剩余全量；成功后全部分片在新提交恰好执行一次', () => {
  const current = currentPlan();
  let prior = schedulePlan(current);
  const failures = current.ids.slice(0, 3);
  let jobs = current.ids.map(id => job(id, failures.includes(id) ? 'failure' : 'success'));
  for (let attempt = 0; attempt < 3; attempt++) {
    prior = schedulePlan({ ...current, run_id: String(101 + attempt), sha: `fix-${attempt}` }, evidence(prior, jobs));
    assert.deepEqual(prior.priority, failures);
    assert.deepEqual(prior.remaining, current.ids.slice(3));
    // GitHub 可能没有展开被阻止的矩阵，也可能显示为 skipped。
    jobs = [...failures.map(id => job(id, 'failure')), job(prior.remaining[0], 'skipped')];
  }
  const passed = [...prior.priority, ...prior.remaining].map(id => job(id));
  assert.equal(new Set(passed.map(item => item.name)).size, current.ids.length);
  const after = schedulePlan(current, evidence(prior, passed));
  assert.deepEqual(after.remaining, current.ids);
});

test('取消、跳过、超时和未知结论均不视为成功', () => {
  const current = currentPlan(), full = schedulePlan(current);
  for (const conclusion of ['cancelled', 'skipped', 'timed_out', 'action_required', null]) {
    const jobs = current.ids.map((id, index) => job(id, index === 0 ? conclusion : 'success'));
    assert.deepEqual(schedulePlan(current, evidence(full, jobs)).priority, [current.ids[0]]);
  }
});

test('跨 PR/分支/workflow、配置变化、新增删除重命名分片一律回退当前全量', () => {
  const current = currentPlan(), full = schedulePlan(current);
  const changed = [
    { context: { ...full.context, pr: 98 } }, { context: { ...full.context, ref: 'refs/heads/other' } },
    { context: { ...full.context, workflow: 'other' } }, { fingerprint: 'incompatible' },
    { ids: [...full.ids, 'visual/new/en'], remaining: [...full.remaining, 'visual/new/en'] },
    { ids: full.ids.slice(1), remaining: full.remaining.slice(1) },
    { ids: ['visual/renamed/en', ...full.ids.slice(1)], remaining: ['visual/renamed/en', ...full.remaining.slice(1)] },
    { remaining: full.remaining.slice(1) },
  ];
  for (const patch of changed) {
    const result = schedulePlan(current, evidence({ ...full, ...patch }, full.ids.map(id => job(id, 'failure'))));
    assert.deepEqual(result.priority, []);
    assert.deepEqual(result.remaining, current.ids);
    assert.match(result.reason, /回退全量/);
  }
});

test('缺失、重复或未知分片不可映射时回退；部署入口的其他套件不会混入', () => {
  const current = currentPlan(), full = schedulePlan(current), jobs = current.ids.map(id => job(id, 'failure'));
  for (const invalid of [jobs.slice(1), [...jobs, jobs[0]], [...jobs, job('visual/unknown/en')], []]) {
    assert.deepEqual(schedulePlan(current, evidence(full, invalid)).priority, []);
  }
  assert.deepEqual(schedulePlan(current, evidence(full, [...jobs, job('animations/texas/gameplay')])).priority, current.ids);
});

test('Re-run failed jobs 合并同一提交各分片最新 attempt，保留未重跑的通过分片', () => {
  const current = currentPlan(), full = schedulePlan(current);
  const jobs = full.ids.map((id, index) => job(id, index === 0 ? 'failure' : 'success'));
  const rerun = { ...job(full.ids[0]), run_attempt: 2 };
  const result = schedulePlan(current, evidence(full, [rerun, ...jobs]));
  assert.deepEqual(result.priority, []);
  assert.deepEqual(result.remaining, full.ids);
  const failed = { ...rerun, conclusion: 'cancelled' };
  assert.deepEqual(schedulePlan(current, evidence(full, [...jobs, failed])).priority, [full.ids[0]]);
});

/**
 * 模拟 GitHub needs，验证所有阶段组合，不依赖旧提交结果。
 * @param priority - 优先分片列表。
 */
function gateNeeds(priority = ['a']) {
  const remaining = ['a', 'b'].filter(id => !priority.includes(id));
  return { accounts: { result: 'success', outputs: {
    matrix: JSON.stringify({ include: ['a', 'b'] }), priority: JSON.stringify({ include: priority }),
    remaining: JSON.stringify({ include: remaining }), priority_count: String(priority.length), remaining_count: String(remaining.length),
  } }, priority: { result: priority.length ? 'success' : 'skipped' },
  remaining: { result: remaining.length ? 'success' : 'skipped' } };
}

test('门禁拒绝非空阶段被跳过、失败、取消及不完整计划', () => {
  for (const priority of [[], ['a'], ['a', 'b']]) assert.doesNotThrow(() => assertFullSuccess(gateNeeds(priority)));
  for (const phase of ['accounts', 'priority', 'remaining']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = gateNeeds();
      needs[phase].result = result;
      assert.throws(() => assertFullSuccess(needs));
    }
  }
  const needs = gateNeeds();
  needs.accounts.outputs.remaining = '{"include":["a"]}';
  assert.throws(() => assertFullSuccess(needs), /重叠/);
});
