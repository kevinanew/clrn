import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseRepository, packageName, selectRelease, validateBuildInformation, verifyPackage } from './release.mjs';

const directory = fileURLToPath(new URL('./artifacts', import.meta.url));
const tag = process.env.ANDROID_RELEASE_TAG || '';
if (process.env.GITHUB_ACTIONS === 'true' && !process.env.GH_TOKEN) {
  throw new Error('下载步骤需要把 GitHub Actions 内置 github.token 传入 GH_TOKEN。');
}
// 由 gh 管理认证；CI 仅在下载步骤注入只读 Token，不将凭据写入产物。
const endpoint = tag
  ? `repos/${releaseRepository}/releases/tags/${encodeURIComponent(tag)}`
  : `repos/${releaseRepository}/releases?per_page=100`;
const result = JSON.parse(execFileSync('gh', ['api', endpoint, ...(tag ? [] : ['--paginate', '--slurp'])],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const release = selectRelease(tag ? [result] : result.flat(), tag);
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(join(directory, '.download-'));
try {
  execFileSync('gh', ['release', 'download', release.tag_name, '--repo', releaseRepository,
    '--dir', temporary, '--pattern', 'build-info.json', '--pattern', packageName], { stdio: 'inherit' });
  const information = validateBuildInformation(JSON.parse(await readFile(join(temporary, 'build-info.json'), 'utf8')), release);
  await verifyPackage(join(temporary, packageName), information);
  await writeFile(join(temporary, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  await rm(join(directory, 'current'), { recursive: true, force: true });
  await rename(temporary, join(directory, 'current'));
  console.log(`已验证 ${release.tag_name}，应用提交 ${information.applicationCommit}，SHA-256 ${information.package.sha256}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
// 路径只包含仓库固定目录，便于本地与 CI 使用同一入口。
console.log(`APK 目录：${join(dirname(fileURLToPath(import.meta.url)), 'artifacts/current')}`);
