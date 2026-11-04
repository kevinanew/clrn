/** 验证真实 API 形状、分页、重跑及附件读取的安全回退边界。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { decodePlan, githubReader, loadHistory, readPages } from './ci-schedule-api.mjs';

test('分页读取超过一页的结果，拒绝异常或截断', async () => {
  const calls = [];
  /**
   * 返回第一整页及尾页。
   * @param path - 带分页参数的 API 路径。
   */
  const read = async path => {
    calls.push(path);
    return { jobs: path.endsWith('page=1') ? Array(100).fill({ id: 1 }) : [{ id: 2 }] };
  };
  assert.equal((await readPages(read, 'jobs?filter=latest', 'jobs')).length, 101);
  assert.equal(calls.length, 2);
  await assert.rejects(readPages(/** 返回无效 API 数据。 */ async () => ({}), 'jobs?', 'jobs'));
});

/**
 * 建立具有多个分支、并发新运行和重跑附件的历史 API。
 * @param status - 上次运行状态。
 */
function historyApi(status = 'completed') {
  const current = { id: 10, run_number: 10, workflow_id: 7, event: 'pull_request', head_branch: 'feature', head_repository: { id: 1 } };
  const previous = { ...current, id: 9, run_number: 9, status, head_sha: 'old' };
  const calls = [];
  /**
   * 记录调用并提供真实 API 形状，未知路径必须失败。
   * @param path - API 请求路径。
   */
  const read = async path => {
    calls.push(path);
    if (path === 'actions/runs/10') return current;
    if (path.startsWith('actions/workflows/7/runs?')) return { workflow_runs: [
      { ...previous, id: 11, run_number: 11 }, { ...previous, head_repository: { id: 2 } }, previous,
    ] };
    if (path.startsWith('actions/runs/9/artifacts?')) return { artifacts: [
      { id: 1, name: 'ci-plan-visual-1' }, { id: 2, name: 'ci-plan-visual-2' },
      { id: 3, name: 'ci-plan-animations-3' },
    ] };
    if (path === 'actions/artifacts/2/zip') return Buffer.from('{"version":2}');
    if (path.startsWith('actions/runs/9/jobs?filter=all')) return { jobs: [{ name: 'all attempts' }] };
    throw new Error(`不应读取 ${path}`);
  };
  return { read, calls };
}

test('只选择本分支本仓库对应工作流的较早运行，使用重跑后的最新任务及计划', async () => {
  const api = historyApi();
  const history = await loadHistory({ read: api.read, runId: 10, mode: 'visual',
    decode: /**
     * 替换 ZIP 解码边界。
     * @param bytes - 附件内容。
     */ bytes => JSON.parse(bytes.toString()) });
  assert.equal(history.run.id, 9);
  assert.equal(history.plan.version, 2);
  assert.equal(history.jobs[0].name, 'all attempts');
  assert.match(api.calls[1], /branch=feature&event=pull_request/);
});

test('最近运行未完成或 API 故障时不得绕过它使用更旧历史', async () => {
  const api = historyApi('in_progress');
  await assert.rejects(loadHistory({ read: api.read, runId: 10, mode: 'visual' }), /仍在执行/);
  assert.equal(api.calls.length, 2);
  await assert.rejects(loadHistory({ read: /** 模拟不可用 API。 */ async () => { throw new Error('unavailable'); },
    runId: 10, mode: 'visual' }), /unavailable/);
});

test('ZIP 仅解析固定小型 JSON，不写入工作区', () => {
  const zip = execFileSync('python3', ['-c', 'import io,sys,zipfile\nb=io.BytesIO()\n'
    + 'with zipfile.ZipFile(b,"w") as z: z.writestr("ci-plan.json",\'{"schema":1}\')\n'
    + 'sys.stdout.buffer.write(b.getvalue())']);
  assert.deepEqual(decodePlan(zip), { schema: 1 });
  assert.throws(() => decodePlan(Buffer.alloc(1024 * 1024 + 1)), /过大/);
});

test('附件重定向请求不携带 GitHub token；HTTP 错误保留回退原因', async () => {
  const requests = [];
  const read = githubReader({ repository: 'owner/repo', token: 'private-token',
    /**
     * 提供 API 重定向和附件下载响应。
     * @param url - 请求目标。
     * @param options - 请求配置。
     */
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://download.example/zip' } })
        : new Response('zip');
    } });
  assert.equal((await read('actions/artifacts/1/zip', true)).toString(), 'zip');
  assert.equal(requests[1].options.headers, undefined);
  const bad = githubReader({ repository: 'owner/repo', token: 'token',
    fetcher: /** 模拟权限不足。 */ async () => new Response(null, { status: 403 }) });
  await assert.rejects(bad('actions/runs/1'), /403/);
});
