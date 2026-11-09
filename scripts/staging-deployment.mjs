/**
 * 核对发布记录所指向的 H5 Release；保留线上站点版本探测供独立部署诊断。
 * 供 CLRN 的部署回归流水线读取应用提交和验证公开附件使用。
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { releaseBuildCommit } from './release-web-server.mjs';
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
  if (!validDeploymentRecord(record)) {
    throw new Error('部署记录必须包含 staging 环境和有效部署时间');
  }
  return validateCommit(record.sha);
}

/**
 * 核对部署记录指向的 H5 Release 和 GitHub 保存的附件摘要。
 * @param options - 部署记录、GitHub 凭据和可替换的网络边界。
 */
export async function loadDeploymentRelease(options) {
  const { content, token, fetcher = fetch } = options;
  const commit = readDeploymentRecord(content);
  const artifact = JSON.parse(content).artifact;
  validateArtifact(artifact, commit);
  const response = await fetcher(
    `https://api.github.com/repos/kevinanew/clrn/releases/tags/${artifact.release_tag}`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'clrn-staging-deployment',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000), redirect: 'error' },
  );
  validateReleaseResponse(response);
  const release = await response.json();
  validateRelease(release, artifact, commit);
  return { artifact, release, commit };
}

/**
 * 核对发布记录中的构建信息，保留原有调用接口。
 * @param options - 发布记录及网络边界。
 */
export async function verifyDeploymentArtifact(options) {
  return (await loadDeploymentRelease(options)).artifact;
}

/**
 * 等待站点实际提供指定版本；校验模式只读取一次，防止测试被其他部署覆盖。
 * @param options - 目标提交、站点、等待上限和可替换的网络及时钟边界。
 */
export async function waitForDeployment(options) {
  const { expectedCommit, baseUrl } = options;
  const settings = deploymentSettings(options);
  const commit = validateCommit(expectedCommit);
  const url = stagingUrl(baseUrl);
  const { now } = settings;
  const deadline = now() + settings.maximumWaitMilliseconds;
  let observed;
  do {
    const observation = await observeDeployment(url, settings, commit);
    observed = observation.observed;
    if (observation.matched) return commit;
  } while (await pauseDeployment(settings, deadline, commit, observed));
  throw new Error(`staging 版本不匹配：预期 ${commit}，实际 ${observed}`);
}

/** 仅 undefined 使用原有默认值，显式边界值保持不变。
 * @param options - 调用方提供的边界。 */
function deploymentSettings(options) {
  const settings = {};
  for (const [key, value] of Object.entries({ maximumWaitMilliseconds: 10 * 60_000,
    fetcher: fetch, wait: delay, now: Date.now, log: console.log })) {
    const supplied = options[key];
    settings[key] = supplied === undefined ? value : supplied;
  }
  return settings;
}

/** 校验允许的 HTTPS staging 地址及凭据。
 * @param baseUrl - 调用方站点。 */
function stagingUrl(baseUrl) {
  const url = new URL(baseUrl || 'https://h5.page.shafayouxi.org/');
  if (!validStagingUrl(url)) throw new Error('部署验证仅允许 staging HTTPS 站点');
  return url;
}

/** 保持协议、主机和用户信息的原有限制。
 * @param url - 已解析站点。 */
function validStagingUrl(url) {
  return [url.protocol === 'https:', !url.username, !url.password,
    ['h5.page.shafayouxi.org', 'h5.shafayouxi.org'].includes(url.hostname)].every(Boolean);
}

/** 探测单次版本并保留网络异常的原有观测文本。
 * @param url - staging 站点。
 * @param settings - 网络及时钟边界。
 * @param commit - 预期提交。 */
async function observeDeployment(url, settings, commit) {
  const { now, fetcher } = settings;
  url.searchParams.set('deployment-check', String(now()));
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), redirect: 'error',
      headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return deploymentObservation(observedBuildCommit(await response.text()), commit, settings);
  } catch (error) { return { observed: error.message, matched: false }; }
}

/** 执行部署记录读取、测试前等待或测试后校验。 */
async function main() {
  const command = process.argv[2];
  if (command === 'record') return recordDeployment();
  if (['wait', 'verify'].includes(command)) return checkDeploymentCommand(command);
  throw new Error('用法：node scripts/staging-deployment.mjs record|wait|verify');
}

/** 将固定记录及应用编号导出给后续 CI 步骤。 */
async function recordDeployment() {
  const content = readFileSync(new URL('../deployments/staging.json', import.meta.url), 'utf8');
  const commit = readDeploymentRecord(content);
  await verifyDeploymentArtifact({ content, token: process.env.GITHUB_TOKEN });
  if (!process.env.GITHUB_OUTPUT) throw new Error('缺少 GITHUB_OUTPUT');
  appendFileSync(process.env.GITHUB_OUTPUT, `application_commit=${commit}\nrelease_record=${JSON.stringify(JSON.parse(content))}\n`);
  console.log(`本轮验证应用提交：${commit}`);
}

/** 执行等待或单次校验，等待成功时向后续测试导出版本。
 * @param command - wait 或 verify。 */
async function checkDeploymentCommand(command) {
  const commit = await waitForDeployment({ expectedCommit: process.env.CLRN_EXPECTED_APPLICATION_COMMIT,
    baseUrl: process.env.VISUAL_BASE_URL || process.env.E2E_STAGING_URL,
    maximumWaitMilliseconds: command === 'verify' ? 0 : 10 * 60_000 });
  exportDeploymentCommit(command, commit);
}

/** 保留 wait 模式才导出环境变量的行为。
 * @param command - 当前子命令。
 * @param commit - 已核对的版本。 */
function exportDeploymentCommit(command, commit) {
  if (command === 'wait' && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `E2E_EXPECT_BUILD_SHA=${commit}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(/** 输出部署校验的安全错误信息并设置失败退出码。
 * @param error - 当前操作抛出的错误。 */ error => { console.error(error.message); process.exitCode = 1; });
}

/** 校验环境和部署时间，空记录应安全拒绝。
 * @param record - 解析后的部署记录。 */
function validDeploymentRecord(record) {
  if (!record) return false;
  return deploymentRecordFields(record);
}

/** 核对发布记录中的附件身份和内容摘要。
 * @param artifact - 记录中的附件信息。
 * @param commit - 已验证提交编号。 */
function validateArtifact(artifact, commit) {
  if (!artifact) throw new Error('staging 部署记录缺少有效的 H5 构建包信息');
  const checks = [
    /** 核对固定标签格式及提交。
     * @param item - 附件记录。 */ item => new RegExp(`^web-staging-[1-9][0-9]{0,8}-${commit.slice(0, 12)}$`).test(item.release_tag),
    /** 核对公开 Release 地址。
     * @param item - 附件记录。 */ item => item.release_url === `https://github.com/kevinanew/clrn/releases/tag/${item.release_tag}`,
    /** 核对固定附件名。
     * @param item - 附件记录。 */ item => item.name === 'web-staging.tar.gz',
    /** 核对正整数大小。
     * @param item - 附件记录。 */ item => Number.isSafeInteger(item.size) && item.size >= 1,
    /** 核对完整摘要。
     * @param item - 附件记录。 */ item => /^[a-f0-9]{64}$/.test(item.sha256 || ''),
  ];
  if (!checks.every(/** 逐项校验并保持短路。
   * @param check - 当前校验函数。 */ check => check(artifact))) throw new Error('staging 部署记录缺少有效的 H5 构建包信息');
}

/** 核对已上传附件存在且元数据一致。
 * @param asset - GitHub 附件。
 * @param expected - 预期元数据。 */
function uploadedAsset(asset, expected) {
  if (!asset) return false;
  return Object.entries({ state: 'uploaded', ...expected }).every(/** 核对附件元数据。
   * @param entry - 预期字段和值。 */ ([key, value]) => asset[key] === value);
}

/** 核对 Release 正文含构建标记及应用提交。
 * @param release - GitHub Release。
 * @param commit - 应用提交。 */
function releaseBodyMatches(release, commit) {
  return release.body?.includes('<!-- laiwan-web-staging-package -->') && release.body.includes(`应用提交：${commit}`);
}

/** 验证 GitHub Release 的身份、发布状态和两个附件。
 * @param release - GitHub Release。
 * @param artifact - 部署记录附件。
 * @param commit - 应用提交。 */
function validateRelease(release, artifact, commit) {
  const archive = release.assets?.find(/** 查找构建压缩包。
   * @param candidate - GitHub 附件。 */ candidate => candidate.name === artifact.name);
  const information = release.assets?.find(/** 查找构建信息。
   * @param candidate - GitHub 附件。 */ candidate => candidate.name === 'build-info.json');
  validateReleaseFields(release, artifact, commit, archive, information);
}

/** 按原始顺序核对 Release 字段，保持无效数据的拒绝语义。
 * @param release - GitHub Release。
 * @param artifact - 部署记录附件。
 * @param commit - 应用提交。
 * @param archive - 压缩包附件。
 * @param information - 信息附件。 */
function validateReleaseFields(release, artifact, commit, archive, information) {
  const checks = [
    /** 核对固定发布标签。 */ () => release.tag_name === artifact.release_tag,
    /** 排除草稿。 */ () => !release.draft,
    /** 必须为预发布构建。 */ () => Boolean(release.prerelease),
    /** 核对构建标记与应用版本。 */ () => releaseBodyMatches(release, commit),
    /** 核对已上传压缩包大小与摘要。 */ () => uploadedAsset(archive, { size: artifact.size, digest: `sha256:${artifact.sha256}` }),
    /** 核对构建信息附件已上传。 */ () => uploadedAsset(information, {}),
  ];
  if (!checks.every(/** 保持原始短路顺序。
   * @param check - 当前校验函数。 */ check => check())) throw new Error('CLRN H5 Release 与 staging 部署记录不一致');
}

/** 在失败响应上保持原有 GitHub HTTP 诊断。
 * @param response - 实际 Release 响应。 */
function validateReleaseResponse(response) {
  if (!response.ok) throw new Error(`读取 CLRN H5 Release 失败：HTTP ${response.status}`);
}

/** 原有截止检查和等待间隔均保持不变。
 * @param settings - 可替换时钟和日志边界。
 * @param deadline - 等待截止时间。
 * @param commit - 预期提交。
 * @param observed - 当前观测版本。 */
async function pauseDeployment(settings, deadline, commit, observed) {
  const { now, log, wait } = settings;
  if (now() >= deadline) return false;
  log(`等待 staging ${commit}；当前：${observed}`);
  await wait(Math.min(10000, deadline - now()));
  return now() < deadline;
}

/** 缺少有效标签时保留固定观测文本。
 * @param html - 站点实际 HTML。 */
function observedBuildCommit(html) { return releaseBuildCommit(html) || '缺少有效 build-version'; }

/** 成功日志仍位于单次探测的异常边界内。
 * @param observed - 页面实际版本。
 * @param commit - 预期版本。
 * @param settings - 可替换日志边界。 */
function deploymentObservation(observed, commit, settings) {
  if (observed !== commit) return { observed, matched: false };
  const { log } = settings;
  log(`已核对 staging 应用版本：${commit}`);
  return { observed, matched: true };
}

/** 按原顺序校验记录，日期解析前必须先确认类型。
 * @param record - 非空部署记录。 */
function deploymentRecordFields(record) {
  const checks = [
    /** 核对 staging 环境。 */ () => record.environment === 'staging',
    /** 核对日期类型。 */ () => typeof record.deployed_at === 'string',
    /** 核对日期有效性。 */ () => Number.isFinite(Date.parse(record.deployed_at)),
  ];
  return checks.every(/** 保持字段短路校验。
   * @param check - 当前校验函数。 */ check => check());
}
