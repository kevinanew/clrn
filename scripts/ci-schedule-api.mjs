/** 读取同一工作流、分支及事件的最新历史，查询失败由调用方回退全量。 */
import { execFileSync } from 'node:child_process';

/**
 * 创建带超时的只读 GitHub API 边界。
 * @param options - 仓库、凭据及可替换的网络边界。
 */
export function githubReader({ repository, token, fetcher = fetch }) {
  /**
   * 读取仓库内 API 资源；下载附件时单独跟随无凭据重定向。
   * @param path - API 相对路径。
   * @param binary - 是否读取 ZIP。
   */
  return async function read(path, binary = false) {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000), redirect: 'manual',
    });
    if (binary && response.status === 302) {
      const location = new URL(response.headers.get('location'));
      if (location.protocol !== 'https:') throw new Error('历史附件下载地址无效');
      const download = await fetcher(location.href, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!download.ok) throw new Error(`历史附件下载 HTTP ${download.status}`);
      return Buffer.from(await download.arrayBuffer());
    }
    if (!response.ok) throw new Error(`历史 API HTTP ${response.status}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}

/**
 * 分页读取完整列表，限制异常数据量并拒绝静默截断。
 * @param read - API 边界。
 * @param path - 已包含查询参数的 API 路径。
 * @param key - 列表字段。
 */
export async function readPages(read, path, key) {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const separator = path.endsWith('?') ? '' : '&';
    const result = await read(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(result[key])) throw new Error('历史 API 列表格式无效');
    items.push(...result[key]);
    if (result[key].length < 100) return items;
  }
  throw new Error('历史列表过大，不能可靠读取');
}

/**
 * 按 API 的创建时间倒序查找最近较早运行，避免下载整个历史。
 * @param read - API 边界。
 * @param current - 当前运行元数据。
 */
async function previousRun(read, current) {
  const query = `branch=${encodeURIComponent(current.head_branch)}&event=${encodeURIComponent(current.event)}`;
  for (let page = 1; page <= 20; page++) {
    const { workflow_runs: runs } = await read(`actions/workflows/${current.workflow_id}/runs?${query}&per_page=100&page=${page}`);
    const candidates = runs.filter(run => run.run_number < current.run_number
      && run.head_branch === current.head_branch && run.event === current.event
      && run.head_repository?.id === current.head_repository?.id);
    if (candidates.length) return candidates.sort((a, b) => b.run_number - a.run_number)[0];
    if (runs.length < 100) return undefined;
  }
  throw new Error('无法可靠查到最近历史');
}

/**
 * 只解析一个小型 JSON 文件，不将历史 ZIP 解压到工作区。
 * @param archive - 下载的计划附件 ZIP。
 */
export function decodePlan(archive) {
  if (archive.length > 1024 * 1024) throw new Error('历史计划附件过大');
  const script = 'import io,json,sys,zipfile\n'
    + 'z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\n'
    + 'assert z.namelist()==["ci-plan.json"]\n'
    + 'assert z.getinfo("ci-plan.json").file_size<=1048576\n'
    + 'print(json.dumps(json.loads(z.read("ci-plan.json"))))\n';
  return JSON.parse(execFileSync('python3', ['-c', script], { input: archive, maxBuffer: 1024 * 1024 }).toString());
}

/**
 * 选取最新的较早运行；不会越过不完整的新历史而复用旧失败状态。
 * @param options - 当前 run、工作流套件和 API 边界。
 */
export async function loadHistory({ read, runId, mode, decode = decodePlan }) {
  const current = await read(`actions/runs/${runId}`);
  const previous = await previousRun(read, current);
  if (!previous) return undefined;
  if (previous.status !== 'completed') throw new Error('最近历史仍在执行');
  const artifacts = await readPages(read, `actions/runs/${previous.id}/artifacts?`, 'artifacts');
  const prefix = `ci-plan-${mode}-`;
  const candidates = artifacts.filter(item => item.name.startsWith(prefix)
    && /^\d+$/.test(item.name.slice(prefix.length)) && !item.expired);
  candidates.sort((a, b) => Number(b.name.slice(prefix.length)) - Number(a.name.slice(prefix.length)));
  if (!candidates.length) throw new Error('最近历史缺少完整计划附件');
  const plan = decode(await read(`actions/artifacts/${candidates[0].id}/zip`, true));
  const jobs = await readPages(read, `actions/runs/${previous.id}/jobs?filter=all`, 'jobs');
  return { run: previous, plan, jobs };
}
