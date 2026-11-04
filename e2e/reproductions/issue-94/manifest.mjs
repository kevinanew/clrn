/** 保存已校验构建、CLRN 提交及当前测试内容指纹，不包含账号或连接凭据。 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 为当前复现目录和代理代码生成内容摘要，允许区分尚未提交的本地验证。
 * @param repository - 当前 CLRN 工作区根目录。
 */
async function sourceDigests(repository) {
  const directory = 'e2e/reproductions/issue-94';
  const files = (await readdir(path.join(repository, directory)))
    .filter(name => /\.(?:ts|mjs|py)$/.test(name)).map(name => `${directory}/${name}`);
  files.push('e2e/mitmproxy/texas_faults.py', 'e2e/mitmproxy/test_texas_faults.py', 'package-lock.json');
  const digests = {};
  for (const file of files.sort()) {
    digests[file] = createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex');
  }
  return digests;
}

/**
 * 写出固定版本及来源边界，明确共享后端部署版本尚未核实。
 * @param repository - 当前 CLRN 工作区根目录。
 * @param release - 已通过实际字节校验的应用构建。
 * @param runId - 本轮独立输出目录名。
 */
export async function writeManifest(repository, release, runId) {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('ISSUE94_RUN_ID 必须是字母、数字或连字符');
  const directory = path.join(repository, 'e2e/test-results/issue-94', runId);
  await mkdir(directory, { recursive: true });
  const git = /**
   * 只读取当前工作区版本及是否有改动。
   * @param argumentsList - Git 查询参数。
   */ argumentsList => execFileSync('git', ['-C', repository, ...argumentsList], { encoding: 'utf8' }).trim();
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    runId, createdAt: new Date().toISOString(),
    applicationCommit: release.commit, releaseTag: release.releaseTag, archiveSha256: release.sha256,
    clrnCommit: git(['rev-parse', 'HEAD']), worktreeHasChanges: Boolean(git(['status', '--porcelain'])),
    sourceSha256: await sourceDigests(repository),
    backend: { stagingDeployment: 'not-verified', isolatedSource: 'recorded separately by backend_contract.py' },
    initialization: 'normal application startup and real login; no visual fixtures',
  }, null, 2) + '\n');
  console.log(`本轮复现产物：e2e/test-results/issue-94/${runId}`);
}
