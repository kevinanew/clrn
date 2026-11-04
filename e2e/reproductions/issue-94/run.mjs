/** 固定并校验 Release 并取得独占账号；金币匹配前置检查额外取得第二账号锁。 */
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { prepareReleaseWeb } from '../../../scripts/prepare-release-web.mjs';
import { readTestingApiToken } from '../../../scripts/prepare-test-account.mjs';
import { writeManifest } from './manifest.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const launcher = fileURLToPath(import.meta.url);

/**
 * 运行子进程并保留退出码；转发取消信号，让账号及服务器包装器完成清理。
 * @param argumentsList - Node 子进程参数。
 * @param environment - 仅经环境传递的本轮凭据和固定构建信息。
 */
async function execute(argumentsList, environment) {
  const child = spawn(process.execPath, argumentsList, { cwd: repository, env: environment, stdio: 'inherit' });
  const interrupt = /** 转发取消信号。 */ () => child.kill('SIGINT');
  const terminate = /** 转发终止信号。 */ () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

/** 根据内部阶段分别准备构建、保留第一账号及启动持有第二账号的测试命令。 */
async function main() {
  if (process.argv[2] === 'reserve-peer') {
    return execute(['scripts/with-test-account.mjs', '--', process.execPath,
      'scripts/with-release-web-server.mjs', process.execPath, 'node_modules/playwright/cli.js',
      'test', '--config', 'e2e/reproductions/issue-94/playwright.config.ts', ...process.argv.slice(3)],
    { ...process.env, ISSUE94_PEER_USERNAME: process.env.E2E_TEST_USERNAME,
      ISSUE94_PEER_PASSWORD: process.env.E2E_TEST_PASSWORD });
  }
  const deployment = process.env.ISSUE94_TESTING_DEPLOYMENT_FILE;
  const token = await readTestingApiToken(process.env, deployment ? pathToFileURL(path.resolve(deployment)) : undefined);
  const content = await readFile(new URL('../../../deployments/staging.json', import.meta.url), 'utf8');
  const release = await prepareReleaseWeb({ content, token: process.env.GITHUB_TOKEN });
  try {
    const runId = process.env.ISSUE94_RUN_ID || `${Date.now()}-${process.pid}`;
    await writeManifest(repository, release, runId);
    const coin = process.argv.includes('--coin-baseline');
    const command = coin ? [launcher, 'reserve-peer', 'coin-table.scenario.ts']
      : ['scripts/with-release-web-server.mjs', process.execPath, 'node_modules/playwright/cli.js',
        'test', '--config', 'e2e/reproductions/issue-94/playwright.config.ts',
        ...process.argv.slice(2)];
    return await execute(['scripts/with-test-account.mjs', '--', process.execPath, ...command], {
      ...process.env, TESTING_API_TOKEN: token, CLRN_RELEASE_WEB_ROOT: release.webRoot,
      CLRN_EXPECTED_APPLICATION_COMMIT: release.commit, CLRN_RELEASE_TAG: release.releaseTag,
      ISSUE94_RUN_ID: runId,
    });
  } finally {
    await rm(path.dirname(release.webRoot), { recursive: true, force: true });
  }
}

main().then(code => { process.exitCode = code; }).catch(() => {
  console.error('issue-94 定向复现启动失败；检查构建、两个空闲账号及测试令牌配置');
  process.exitCode = 1;
});
