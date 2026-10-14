import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

export const applicationRepository = 'kevinanew/laiwan_react_native';
export const applicationId = 'com.ac.laiwanDev';
export const packageName = 'laiwan-android-staging.apk';
const releasePattern = /^android-visual-staging-(\d+)-([a-f0-9]{12})$/;

/**
 * 从发布列表选出指定版本或最新已发布的安卓 Staging 测试版本。
 * @param releases - GitHub 返回的 Release 列表。
 * @param tag - 可选的固定版本标签。
 */
export function selectRelease(releases, tag = '') {
  if (tag && !releasePattern.test(tag)) throw new Error('无效的 Android Staging Release 标签。');
  const candidates = releases.filter(release => !release.draft && release.published_at
    && releasePattern.test(release.tag_name)
    && release.body?.includes('<!-- laiwan-android-visual-staging schema=1 -->')
    && (!tag || release.tag_name === tag));
  candidates.sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at));
  const selected = candidates[0];
  if (!selected) throw new Error('未找到已发布的 Android Staging 测试 Release。');
  for (const name of ['build-info.json', packageName]) {
    const assets = selected.assets.filter(asset => asset.name === name && asset.state === 'uploaded');
    if (assets.length !== 1 || assets[0].size <= 0) throw new Error(`Release 附件缺失或无效：${name}`);
  }
  return selected;
}

/**
 * 核对构建平台、环境、版本和附件身份，拒绝错误包及不一致的元数据。
 * @param information - Release 中的构建元数据。
 * @param release - 已选定的 GitHub Release。
 */
export function validateBuildInformation(information, release) {
  const match = releasePattern.exec(release.tag_name);
  const asset = release.assets.find(item => item.name === packageName);
  if (!match || information.schemaVersion !== 1 || information.platform !== 'android'
    || information.environment !== 'staging' || information.applicationId !== applicationId
    || information.releaseTag !== release.tag_name || !/^[a-f0-9]{40}$/.test(information.applicationCommit)
    || !information.applicationCommit.startsWith(match[2]) || information.buildNumber !== Number(match[1])
    || information.signing !== 'visual-staging-testing-only'
    || !['x86_64', 'arm64-v8a'].every(value => information.architectures?.includes(value))
    || information.package?.name !== packageName || information.package.size !== asset?.size
    || !/^[a-f0-9]{64}$/.test(information.package.sha256)
    || (asset.digest && asset.digest !== `sha256:${information.package.sha256}`)) {
    throw new Error('Release 构建信息不匹配，拒绝安装。');
  }
  return information;
}

/**
 * 流式核对安装包大小与 SHA-256，避免下载中断或错误附件进入测试。
 * @param file - 本地安装包路径。
 * @param information - 经过身份校验的构建信息。
 */
export async function verifyPackage(file, information) {
  if ((await stat(file)).size !== information.package.size) throw new Error('APK 大小校验失败。');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== information.package.sha256) throw new Error('APK SHA-256 校验失败。');
}

/**
 * 每次运行前重新校验本地附件，防止复用下载目录时混入其他版本。
 * @param directory - 下载目录。
 */
export async function readVerifiedBuild(directory) {
  const information = JSON.parse(await readFile(`${directory}/build-info.json`, 'utf8'));
  const release = JSON.parse(await readFile(`${directory}/release.json`, 'utf8'));
  validateBuildInformation(information, selectRelease([release]));
  await verifyPackage(`${directory}/${packageName}`, information);
  return information;
}
