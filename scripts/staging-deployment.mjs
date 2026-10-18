/**
 * 核对 Staging 部署记录所指向的 H5 Release，并等待站点提供指定应用版本。
 * 供 CLRN 的部署回归流水线读取应用提交和验证公开附件使用。
 */

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
 * 核对部署记录指向的 H5 Release 和 GitHub 保存的附件摘要。
 * @param options - 部署记录、GitHub 凭据和可替换的网络边界。
 */
export async function verifyDeploymentArtifact(options) {
  const { content, token, fetcher = fetch } = options;
  const commit = readDeploymentRecord(content);
  const artifact = JSON.parse(content).artifact;
  const expectedTag = new RegExp(`^web-staging-[1-9][0-9]{0,8}-${commit.slice(0, 12)}$`);
  if (!artifact || !expectedTag.test(artifact.release_tag) ||
    artifact.release_url !== `https://github.com/kevinanew/clrn/releases/tag/${artifact.release_tag}` ||
    artifact.name !== 'web-staging.tar.gz' || !Number.isSafeInteger(artifact.size) || artifact.size < 1 ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) {
    throw new Error('staging 部署记录缺少有效的 H5 构建包信息');
  }
  const response = await fetcher(
    `https://api.github.com/repos/kevinanew/clrn/releases/tags/${artifact.release_tag}`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'clrn-staging-deployment',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000), redirect: 'error' },
  );
  if (!response.ok) {
    throw new Error(`读取 CLRN H5 Release 失败：HTTP ${response.status}`);
  }
  const release = await response.json();
  const archive = release.assets?.find(candidate => candidate.name === artifact.name);
  const information = release.assets?.find(candidate => candidate.name === 'build-info.json');
  if (release.tag_name !== artifact.release_tag || release.draft || !release.prerelease ||
    !release.body?.includes('<!-- laiwan-web-staging-package -->') ||
    !release.body.includes(`应用提交：${commit}`) ||
    !archive || archive.state !== 'uploaded' || archive.size !== artifact.size ||
    archive.digest !== `sha256:${artifact.sha256}` ||
    !information || information.state !== 'uploaded') {
    throw new Error('CLRN H5 Release 与 staging 部署记录不一致');
  }
  return artifact;
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
    const content = readFileSync(new URL('../deployments/staging.json', import.meta.url), 'utf8');
    const commit = readDeploymentRecord(content);
    await verifyDeploymentArtifact({ content, token: process.env.GITHUB_TOKEN });
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
