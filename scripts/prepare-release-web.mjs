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
  const maximumSize = asset.name === 'build-info.json' ? 65536 : 128 * 1024 * 1024;
  if (!Number.isSafeInteger(asset.id) || asset.id < 1 || !Number.isSafeInteger(asset.size)
    || asset.size < 1 || asset.size > maximumSize || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) {
    throw new Error('Release 附件元数据无效或大小超过上限');
  }
  const response = await fetcher(`https://api.github.com/repos/kevinanew/clrn/releases/assets/${asset.id}`, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'clrn-release-web',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(120000), redirect: 'follow',
  });
  if (!response.ok || !response.body) throw new Error(`下载 Release 附件失败：HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > asset.size) throw new Error('Release 附件实际大小超过记录');
    chunks.push(chunk);
  }
  const contents = Buffer.concat(chunks);
  const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
  if (size !== asset.size || digest !== asset.digest) throw new Error('Release 附件实际摘要或大小不匹配');
  return contents;
}

/**
 * 校验并准备一个发布版本；发生错误时清除本次临时目录，不回退到在线站点。
 * @param options - 固定发布记录、预期提交、读取凭据、临时目录和可替换网络边界。
 */
export async function prepareReleaseWeb({ content, expectedCommit, token, temporaryDirectory = tmpdir(), fetcher = fetch }) {
  const { artifact, release, commit } = await loadDeploymentRelease({ content, token, fetcher });
  if (expectedCommit && commit !== expectedCommit.toLowerCase()) throw new Error('发布记录与指定应用提交不一致');
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
  if (information.schemaVersion !== 1 || information.platform !== 'web' || information.environment !== 'staging'
    || information.applicationCommit !== commit || information.releaseTag !== artifact.release_tag
    || artifact.release_tag !== `web-staging-${information.buildNumber}-${commit.slice(0, 12)}`
    || information.archive?.name !== artifact.name || information.archive?.size !== artifact.size
    || information.archive?.sha256 !== artifact.sha256) throw new Error('build-info.json 与发布记录不一致');
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
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, variables);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `### 本轮 H5 Release\n\n- Release：${prepared.releaseTag}\n- 应用提交：${prepared.commit}\n- SHA-256：${prepared.sha256}\n`);
  console.log(variables.trim());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(/**
   * 将下载或校验失败传递给持续集成。
   * @param error - 准备失败原因。
   */ error => { console.error(error.message); process.exitCode = 1; });
}
