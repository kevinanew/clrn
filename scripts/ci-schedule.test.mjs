/** 离线运行真实规划与门禁命令，验证 PR 事件身份及最终阶段输出。 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const repository = fileURLToPath(new URL('../', import.meta.url));
const command = join(repository, 'scripts/ci-schedule.mjs');
const record = JSON.parse(readFileSync(join(repository, 'deployments/staging.json'), 'utf8'));
const api = 'https://api.github.com/repos/kevinanew/clrn/';

/**
 * 构造与已核验发布记录一致的只读 Release 响应。
 * @returns 构建核验需要的 Release 元数据。
 */
function release() {
  return { tag_name: record.artifact.release_tag, draft: false, prerelease: true,
    body: `<!-- laiwan-web-staging-package -->\n应用提交：${record.sha}`,
    assets: [{ name: record.artifact.name, state: 'uploaded', size: record.artifact.size,
      digest: `sha256:${record.artifact.sha256}` }, { name: 'build-info.json', state: 'uploaded' }] };
}

/**
 * 使用真实 ZIP 解码路径，而非替换计划解析逻辑。
 * @param plan - 完整历史计划。
 */
function zipPlan(plan) {
  return execFileSync('python3', ['-c', 'import io,sys,zipfile\nb=io.BytesIO()\n'
    + 'with zipfile.ZipFile(b,"w") as z: z.writestr("ci-plan.json",sys.stdin.buffer.read())\n'
    + 'sys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(plan) }).toString('base64');
}

/**
 * 为每次 CLI 调用隔离事件、API 边界和输出；未知网络请求一律拒绝。
 * @param mode - 视觉或动画工作流。
 * @param options - 当前提交、事件及可选历史实测结果。
 */
function runPlan(mode, options = {}) {
  const { runId, sha, headSha, eventName, previous, jobs, fullRun } = { runId: '100',
    sha: 'a'.repeat(40), headSha: 'b'.repeat(40), eventName: 'pull_request', jobs: [], fullRun: false, ...options };
  const event = options.event ?? { number: 98, pull_request: { head: { sha: headSha } } };
  const directory = mkdtempSync(join(tmpdir(), 'clrn-schedule-'));
  try {
    for (const path of ['scripts', 'visual', '.github']) symlinkSync(join(repository, path), join(directory, path), 'dir');
    const branch = eventName === 'pull_request' ? 'feature' : 'master';
    const current = { id: Number(runId), run_number: Number(runId), workflow_id: 7, event: eventName,
      head_branch: branch, head_sha: headSha, head_repository: { id: 1 } };
    const runs = [current];
    const responses = { [`${api}releases/tags/${record.artifact.release_tag}`]: release(),
      [`${api}actions/runs/${runId}`]: current,
      [`${api}actions/workflows/7/runs?branch=${branch}&event=${eventName}&per_page=100&page=1`]: { workflow_runs: runs } };
    if (previous) {
      runs.push({ ...current, id: Number(previous.run_id), run_number: Number(previous.run_id),
        head_sha: previous.head_sha, status: 'completed', html_url: `${api}actions/runs/${previous.run_id}` });
      responses[`${api}actions/runs/${previous.run_id}/artifacts?per_page=100&page=1`] = {
        artifacts: [{ id: 1, name: `ci-plan-${mode}-1`, expired: false }] };
      responses[`${api}actions/artifacts/1/zip`] = { zip: zipPlan(previous) };
      responses[`${api}actions/runs/${previous.run_id}/jobs?filter=all&per_page=100&page=1`] = { jobs };
    }
    writeFileSync(join(directory, 'responses.json'), JSON.stringify(responses));
    writeFileSync(join(directory, 'event.json'), JSON.stringify(event));
    writeFileSync(join(directory, 'preload.mjs'), `import { readFileSync } from 'node:fs';
const responses = JSON.parse(readFileSync(process.env.CI_SCHEDULE_TEST_RESPONSES, 'utf8'));
globalThis.fetch = async url => {
  if (!Object.hasOwn(responses, url)) throw new Error('Unexpected offline API request: ' + url);
  const body = responses[url];
  return new Response(body.zip ? Buffer.from(body.zip, 'base64') : JSON.stringify(body));
};
`);
    const result = spawnSync(process.execPath, ['--import', join(directory, 'preload.mjs'), command, 'plan', mode], {
      cwd: directory, encoding: 'utf8', env: { ...process.env,
        GITHUB_TOKEN: 'offline-test-token', GITHUB_REPOSITORY: 'kevinanew/clrn', GITHUB_WORKFLOW: mode,
        GITHUB_RUN_ID: runId, GITHUB_SHA: sha, GITHUB_EVENT_NAME: eventName,
        GITHUB_REF: eventName === 'pull_request' ? 'refs/pull/98/merge' : 'refs/heads/master',
        GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_OUTPUT: join(directory, 'outputs'),
        GITHUB_STEP_SUMMARY: join(directory, 'summary'), CI_SCHEDULE_TEST_RESPONSES: join(directory, 'responses.json'),
        CI_SCHEDULE_OPTIONS: JSON.stringify({ release_record: JSON.stringify(record), full_run: fullRun }) },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const outputs = Object.fromEntries(readFileSync(join(directory, 'outputs'), 'utf8').trim().split('\n').map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    return { plan: JSON.parse(readFileSync(join(directory, 'ci-plan.json'), 'utf8')), outputs,
      summary: readFileSync(join(directory, 'summary'), 'utf8') };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/**
 * 在真实命令入口检验当前完整计划的门禁退出状态。
 * @param mode - 工作流套件。
 * @param outputs - 规划命令输出。
 * @param priority - 优先阶段结论。
 * @param remaining - 剩余阶段结论。
 */
function gateStatus(mode, outputs, priority, remaining) {
  return spawnSync(process.execPath, [command, 'gate', mode], { encoding: 'utf8', env: { ...process.env,
    GITHUB_STEP_SUMMARY: '', CI_SCHEDULE_NEEDS: JSON.stringify({ accounts: { result: 'success', outputs },
      priority: { result: priority }, remaining: { result: remaining } }) } }).status;
}

/**
 * 只提供真实执行分片的结果，剩余未展开矩阵不伪造为成功。
 * @param ids - 本轮已执行的稳定标识。
 * @param failure - 可选失败标识。
 */
function jobsFor(ids, failure) {
  return ids.map(id => ({ name: `阶段 / 分片 [ci:${id}]`, status: 'completed', run_attempt: 1,
    conclusion: id === failure ? 'failure' : 'success' }));
}

test('真实 PR CLI 保留不同的 merge/head SHA，连续失败不缩小覆盖且完整成功才放行', () => {
  for (const mode of ['visual', 'animations']) {
    const first = runPlan(mode);
    assert.notEqual(first.plan.sha, first.plan.head_sha);
    assert.equal(first.plan.sha, 'a'.repeat(40));
    assert.equal(first.plan.head_sha, 'b'.repeat(40));
    assert.equal(first.plan.ids.length, mode === 'visual' ? 9 : 7);
    assert.deepEqual(first.plan.remaining, first.plan.ids);
    assert.match(first.summary, new RegExp(first.plan.sha));
    assert.match(first.summary, new RegExp(first.plan.head_sha));
    const failed = first.plan.ids[0];
    const fix = runPlan(mode, { runId: '101', sha: 'c'.repeat(40), headSha: 'd'.repeat(40),
      previous: first.plan, jobs: jobsFor(first.plan.ids, failed) });
    assert.deepEqual(fix.plan.priority, [failed]);
    assert.deepEqual(fix.plan.remaining, first.plan.ids.slice(1));
    const full = JSON.parse(fix.outputs.matrix).include;
    const phases = [...JSON.parse(fix.outputs.priority).include, ...JSON.parse(fix.outputs.remaining).include];
    assert.equal(new Set(phases.map(item => item.account)).size, full.length);
    assert.deepEqual(phases, full);
    assert.equal(gateStatus(mode, fix.outputs, 'success', 'success'), 0);
    for (const outcome of ['failure', 'cancelled', 'skipped']) {
      assert.equal(gateStatus(mode, fix.outputs, outcome, 'skipped'), 1);
      assert.equal(gateStatus(mode, fix.outputs, 'success', outcome), 1);
    }
    const retry = runPlan(mode, { runId: '102', sha: 'e'.repeat(40), headSha: 'f'.repeat(40),
      previous: fix.plan, jobs: jobsFor([failed], failed) });
    assert.deepEqual(retry.plan.priority, [failed]);
    assert.deepEqual(retry.plan.remaining, first.plan.ids.slice(1));
    const next = runPlan(mode, { runId: '103', previous: retry.plan, jobs: jobsFor(retry.plan.ids) });
    assert.deepEqual(next.plan.priority, []);
    assert.deepEqual(next.plan.remaining, first.plan.ids);
    assert.equal(gateStatus(mode, next.outputs, 'skipped', 'success'), 0);
  }
});

test('push 与手动事件使用测试 SHA 作为 head；PR 头部缺失时不冒用 merge SHA', () => {
  for (const eventName of ['push', 'workflow_dispatch']) {
    const { plan } = runPlan('visual', { eventName });
    assert.equal(plan.head_sha, plan.sha);
  }
  const { plan } = runPlan('visual', { event: { number: 98 } });
  assert.equal(plan.head_sha, null);
});

test('手动强制全量保留当前全部分片，不复用历史失败顺序', () => {
  const first = runPlan('visual');
  const { plan } = runPlan('visual', { runId: '101', previous: first.plan,
    jobs: jobsFor(first.plan.ids, first.plan.ids[0]), fullRun: true });
  assert.deepEqual(plan.priority, []);
  assert.deepEqual(plan.remaining, first.plan.ids);
  assert.match(plan.reason, /手动强制全量/);
});

/**
 * 对实际 workflow 条件提供 GitHub 的状态函数及依赖结果。
 * @param condition - workflow 中的布尔表达式。
 * @param needs - 当前各阶段输出与结论。
 * @param cancelled - 当前运行是否取消。
 */
function evaluateCondition(condition, needs, cancelled = false) {
  return runInNewContext(condition, { needs, always: /** 模拟总是评估。 */ () => true,
    cancelled: /** 提供当前取消状态。 */ () => cancelled });
}

test('两个实际 workflow 的依赖与条件在优先失败时阻止剩余任务，仅成功后放行', () => {
  for (const mode of ['visual', 'animations']) {
    const source = readFileSync(join(repository, `.github/workflows/${mode}.yml`), 'utf8');
    const remaining = source.match(/^ {2}remaining:\n((?: {4}[^\n]*\n|\n)+)/m)?.[1];
    assert.ok(remaining, '缺少剩余阶段定义');
    const dependencies = remaining.match(/^ {4}needs: \[([^\]]+)\]/m)?.[1].split(',').map(item => item.trim());
    assert.deepEqual(dependencies, ['accounts', 'priority']);
    const condition = remaining.match(/^ {4}if: >-\n((?: {6}[^\n]*\n)+)/m)?.[1].trim();
    assert.ok(condition, '缺少剩余阶段条件');
    const needs = { accounts: { result: 'success', outputs: { priority_count: '1', remaining_count: '8' } },
      priority: { result: 'success' } };
    assert.equal(evaluateCondition(condition, needs), true);
    for (const result of ['failure', 'cancelled', 'skipped']) {
      needs.priority.result = result;
      assert.equal(evaluateCondition(condition, needs), false);
    }
    needs.accounts.outputs.priority_count = '0';
    assert.equal(evaluateCondition(condition, needs), true);
    assert.equal(evaluateCondition(condition, needs, true), false);
    needs.accounts.result = 'failure';
    assert.equal(evaluateCondition(condition, needs), false);
    needs.accounts.result = 'success';
    needs.accounts.outputs.remaining_count = '0';
    assert.equal(evaluateCondition(condition, needs), false);
  }
});
