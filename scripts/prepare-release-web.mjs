/**
 * 测试任务启动前下载本轮指定的 H5 Release；输入固定发布记录和 GitHub 读取凭据。
 * 校验摘要、构建信息及页面版本后解包，输出独立目录和测试版本环境变量。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDeploymentRelease } from './staging-deployment.mjs';
import { verifyBuildVersion } from './release-web-server.mjs';

/**
 * 通过固定仓库的附件编号下载，核对实际字节的大小和摘要。
 * @param asset - GitHub 返回的附件元数据。
 * @param token - 仅用于 GitHub 请求的读取凭据。
 * @param fetcher - 可替换的网络边界。
 */
async function downloadAsset(asset, token, fetcher) {
  validateAsset(asset);
  const response = await fetcher(`https://api.github.com/repos/kevinanew/clrn/releases/assets/${asset.id}`, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'clrn-release-web',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(120000), redirect: 'follow',
  });
  return readAsset(response, asset);
}

/** 校验附件编号、大小上限与摘要格式。
 * @param asset - GitHub 附件元数据。 */
function validateAsset(asset) {
  if (!validAssetIdentity(asset)) throw new Error('Release 附件元数据无效或大小超过上限');
  if (!validAssetDigest(asset.digest)) throw new Error('Release 附件元数据无效或大小超过上限');
}

/** 在读取字节前拒绝失败状态或缺失正文。
 * @param response - 实际附件响应。
 * @param asset - 已核验的元数据。 */
async function readAsset(response, asset) {
  if (!response.ok || !response.body) throw new Error(`下载 Release 附件失败：HTTP ${response.status}`);
  const contents = await readAssetBody(response.body, asset.size);
  const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
  verifyAssetBytes(contents.length, digest, asset);
  return contents;
}

/** 保留流式大小上限，不能先无界读取再校验。
 * @param body - 实际响应流。
 * @param maximumSize - 记录大小。 */
async function readAssetBody(body, maximumSize) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maximumSize) throw new Error('Release 附件实际大小超过记录');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 核对实际下载内容。
 * @param size - 实际大小。
 * @param digest - 实际摘要。
 * @param asset - 记录元数据。 */
function verifyAssetBytes(size, digest, asset) {
  if (size !== asset.size || digest !== asset.digest) throw new Error('Release 附件实际摘要或大小不匹配');
}

/**
 * 校验并准备一个发布版本；发生错误时清除本次临时目录，不回退到在线站点。
 * @param options - 固定发布记录、预期提交、读取凭据、临时目录和可替换网络边界。
 */
export async function prepareReleaseWeb(options) {
  const { content, expectedCommit, token, temporaryDirectory, fetcher } = releaseOptions(options);
  const { artifact, release, commit } = await loadDeploymentRelease({ content, token, fetcher });
  validateExpectedCommit(expectedCommit, commit);
  const archiveAsset = release.assets.find(/**
   * 查找记录指定的静态构建包。
   * @param asset - Release 附件。
   */ asset => asset.name === artifact.name);
  const informationAsset = release.assets.find(/**
   * 查找同一次构建的信息附件。
   * @param asset - Release 附件。
   */ asset => asset.name === 'build-info.json');
  const informationContents = await downloadAsset(informationAsset, token, fetcher);
  const information = JSON.parse(informationContents);
  validateBuildInformation(information, artifact, commit);
  const archive = await downloadAsset(archiveAsset, token, fetcher);
  const directory = await mkdtemp(path.join(temporaryDirectory, 'clrn-release-web-'));
  const webRoot = path.join(directory, 'site');
  try {
    const archivePath = path.join(directory, artifact.name);
    await writeFile(archivePath, archive);
    await writeFile(path.join(directory, 'build-info.json'), informationContents);
    execFileSync('python3', [fileURLToPath(new URL('./extract-web-package.py', import.meta.url)), archivePath, webRoot],
      { stdio: 'pipe', timeout: 60000 });
    await verifyBuildVersion(webRoot, commit);
    await rm(archivePath);
    return { webRoot, commit, releaseTag: artifact.release_tag, sha256: artifact.sha256 };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** 从本次检出的提交或调用方固定的记录准备构建；不读取远端最新记录。 */
async function main() {
  const content = process.env.CLRN_RELEASE_RECORD
    || await readFile(new URL('../deployments/staging.json', import.meta.url), 'utf8');
  const prepared = await prepareReleaseWeb({ content, token: process.env.GITHUB_TOKEN,
    expectedCommit: process.env.CLRN_EXPECTED_APPLICATION_COMMIT,
    temporaryDirectory: process.env.RUNNER_TEMP || tmpdir() });
  const variables = `CLRN_RELEASE_WEB_ROOT=${prepared.webRoot}\nCLRN_EXPECTED_APPLICATION_COMMIT=${prepared.commit}\nCLRN_RELEASE_TAG=${prepared.releaseTag}\n`;
  await exportReleaseVariables(prepared, variables);
  console.log(variables.trim());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(/**
   * 将下载或校验失败传递给持续集成。
   * @param error - 准备失败原因。
   */ error => { console.error(error.message); process.exitCode = 1; });
}

/** 保留临时目录和网络边界的默认行为。
 * @param options - 准备构建的配置。 */
function releaseOptions({ temporaryDirectory = tmpdir(), fetcher = fetch, ...options }) {
  return { temporaryDirectory, fetcher, ...options };
}

/** 可选预期提交一旦提供必须匹配。
 * @param expected - 调用方固定提交。
 * @param actual - 记录中的提交。 */
function validateExpectedCommit(expected, actual) {
  if (expected && actual !== expected.toLowerCase()) throw new Error('发布记录与指定应用提交不一致');
}

/** 核对构建信息的固定字段及附件信息。
 * @param information - build-info 正文。
 * @param artifact - 部署记录附件。
 * @param commit - 应用提交。 */
function validateBuildInformation(information, artifact, commit) {
  const expected = { schemaVersion: 1, platform: 'web', environment: 'staging', applicationCommit: commit,
    releaseTag: artifact.release_tag };
  const matches = Object.entries(expected).every(/** 比较构建身份字段。
   * @param entry - 字段及预期值。 */ ([key, value]) => information[key] === value);
  if (!matches || !archiveInformationMatches(information, artifact, commit)) throw new Error('build-info.json 与发布记录不一致');
}

/** 核对构建号以及压缩包名、大小和摘要。
 * @param information - 构建信息。
 * @param artifact - 部署记录附件。
 * @param commit - 应用提交。 */
function archiveInformationMatches(information, artifact, commit) {
  if (artifact.release_tag !== `web-staging-${information.buildNumber}-${commit.slice(0, 12)}`) return false;
  return Object.entries({ name: artifact.name, size: artifact.size, sha256: artifact.sha256 }).every(
    /** 核对同一次构建的压缩包。
     * @param entry - 字段及预期值。 */ ([key, value]) => information.archive?.[key] === value);
}

/** 沿用 CI 环境文件与摘要出口。
 * @param prepared - 已核验构建。
 * @param variables - 导出的固定环境变量。 */
async function exportReleaseVariables(prepared, variables) {
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, variables);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `### 本轮 H5 Release\n\n- Release：${prepared.releaseTag}\n- 应用提交：${prepared.commit}\n- SHA-256：${prepared.sha256}\n`);
}

/** 构建信息与压缩包各自保留原始字节上限。
 * @param asset - GitHub 附件。 */
function assetMaximumSize(asset) { return asset.name === 'build-info.json' ? 65536 : 128 * 1024 * 1024; }

/** 附件编号必须是正的安全整数，然后才校验大小。
 * @param asset - GitHub 附件。 */
function validAssetIdentity(asset) {
  if (!Number.isSafeInteger(asset.id)) return false;
  return asset.id >= 1 && validAssetSize(asset);
}

/** 大小必须是上限以内的正安全整数。
 * @param asset - GitHub 附件。 */
function validAssetSize(asset) {
  if (!Number.isSafeInteger(asset.size)) return false;
  return asset.size >= 1 && asset.size <= assetMaximumSize(asset);
}

/** 附件摘要仅接受带前缀的完整 SHA-256。
 * @param digest - GitHub 附件摘要。 */
function validAssetDigest(digest) { return /^sha256:[a-f0-9]{64}$/.test(digest || ''); }
