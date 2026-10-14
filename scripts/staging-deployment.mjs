import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * 校验应用提交编号，拒绝缩写或其他环境的记录。
 * @param commit - 应用完整 Git 提交编号。
 */
export function validateCommit(commit) {
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/i.test(commit)) {
    throw new Error('部署记录必须包含完整的 40 位应用提交编号');
  }
  return commit.toLowerCase();
}

/**
 * 读取并校验上游写入的 staging 部署记录。
 * @param content - 部署记录的 JSON 文本。
 */
export function readDeploymentRecord(content) {
  const record = JSON.parse(content);
  if (!record || record.environment !== 'staging' || typeof record.deployed_at !== 'string'
    || !Number.isFinite(Date.parse(record.deployed_at))) {
    throw new Error('部署记录必须包含 staging 环境和有效部署时间');
  }
  return validateCommit(record.sha);
}

/**
 * 等待站点实际提供指定版本；校验模式只读取一次，防止测试被其他部署覆盖。
 * @param options - 目标提交、站点、等待上限和可替换的网络及时钟边界。
 */
export async function waitForDeployment({ expectedCommit, baseUrl,
  maximumWaitMilliseconds = 10 * 60_000, fetcher = fetch, wait = delay,
  now = Date.now, log = console.log }) {
  const commit = validateCommit(expectedCommit);
  const url = new URL(baseUrl || 'https://h5.page.shafayouxi.org/');
  if (url.protocol !== 'https:' || url.username || url.password
    || !['h5.page.shafayouxi.org', 'h5.shafayouxi.org'].includes(url.hostname)) {
    throw new Error('部署验证仅允许 staging HTTPS 站点');
  }
  const deadline = now() + maximumWaitMilliseconds;
  let observed;
  do {
    url.searchParams.set('deployment-check', String(now()));
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(15000), redirect: 'error',
        headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const tag = html.match(/<meta\b[^>]*\bname=["']build-version["'][^>]*>/i)?.[0];
      observed = tag?.match(/\bcontent=["']([a-f0-9]{40})\s+-\s+[^"']+["']/i)?.[1]?.toLowerCase()
        || '缺少有效 build-version';
      if (observed === commit) {
        log(`已核对 staging 应用版本：${commit}`);
        return commit;
      }
    } catch (error) {
      observed = error.message;
    }
    if (now() >= deadline) break;
    log(`等待 staging ${commit}；当前：${observed}`);
    await wait(Math.min(10000, deadline - now()));
  } while (now() < deadline);
  throw new Error(`staging 版本不匹配：预期 ${commit}，实际 ${observed}`);
}

/** 执行部署记录读取、测试前等待或测试后校验。 */
async function main() {
  const command = process.argv[2];
  if (command === 'record') {
    const commit = readDeploymentRecord(readFileSync(new URL('../deployments/staging.json', import.meta.url), 'utf8'));
    if (!process.env.GITHUB_OUTPUT) throw new Error('缺少 GITHUB_OUTPUT');
    appendFileSync(process.env.GITHUB_OUTPUT, `application_commit=${commit}\n`);
    console.log(`本轮验证应用提交：${commit}`);
  } else if (command === 'wait' || command === 'verify') {
    const commit = await waitForDeployment({ expectedCommit: process.env.CLRN_EXPECTED_APPLICATION_COMMIT,
      baseUrl: process.env.VISUAL_BASE_URL || process.env.E2E_STAGING_URL,
      maximumWaitMilliseconds: command === 'verify' ? 0 : 10 * 60_000 });
    if (command === 'wait' && process.env.GITHUB_ENV) {
      appendFileSync(process.env.GITHUB_ENV, `E2E_EXPECT_BUILD_SHA=${commit}\n`);
    }
  } else {
    throw new Error('用法：node scripts/staging-deployment.mjs record|wait|verify');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
