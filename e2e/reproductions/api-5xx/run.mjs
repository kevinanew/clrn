/** 下载校验固定 Web 构建，持有真实测试账号锁，执行独立 5xx 复现并清理资源。 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareReleaseWeb } from '../../../scripts/prepare-release-web.mjs';
import { readTestingApiToken } from '../../../scripts/prepare-test-account.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * 启动既有账号和 Web Server 包装器，转发取消并保留实际退出码。
 * @param environment - 只经进程环境传递的令牌和固定版本。
 */
async function execute(environment) {
  const child = spawn(process.execPath, ['scripts/with-test-account.mjs', '--', process.execPath,
    'scripts/with-release-web-server.mjs', 'python3', 'e2e/reproductions/api-5xx/gateway.py', '--',
    process.execPath, 'e2e/node_modules/playwright/cli.js',
    'test', '--config', 'e2e/reproductions/api-5xx/playwright.config.ts', ...process.argv.slice(2)],
  { cwd: repository, env: environment, stdio: 'inherit' });
  const interrupt = /** 请求既有包装器清理浏览器、代理、服务器和账号锁。 */ () => child.kill('SIGINT');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    return await new Promise(/** 等待测试退出，不把产品断言失败改写为成功。
     * @param resolve - 接收实际退出码。
     * @param reject - 传播进程启动失败。 */ (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', /** 信号结束也必须返回非零。
       * @param code - 子进程退出状态。 */ code => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

/** 核实固定构建后运行；保留每轮独立证据，结束时删除下载的静态文件。 */
async function main() {
  const deploymentFile = process.env.CLRN_TESTING_DEPLOYMENT_FILE;
  const token = await readTestingApiToken(process.env,
    deploymentFile ? pathToFileURL(resolve(deploymentFile)) : undefined);
  const content = process.env.CLRN_RELEASE_RECORD || await readFile(new URL('../../../deployments/staging.json', import.meta.url), 'utf8');
  const release = await prepareReleaseWeb({ content, token: process.env.GITHUB_TOKEN });
  const runId = `${Date.now()}-${process.pid}`;
  const output = resolve(repository, 'e2e/test-results/api-5xx', runId);
  try {
    await mkdir(output, { recursive: true });
    const sources = {};
    for (const name of ['run.mjs', 'playwright.config.ts', 'fixtures.ts', 'table.ts', 'capture.ts', 'buy-in.ts', 'sit.scenario.ts', 'gateway.py']) {
      sources[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex');
    }
    sources['server_errors.py'] = createHash('sha256')
      .update(await readFile(new URL('../../mitmproxy/server_errors.py', import.meta.url))).digest('hex');
    sources['sit_server_errors.py'] = createHash('sha256')
      .update(await readFile(new URL('../../mitmproxy/sit_server_errors.py', import.meta.url))).digest('hex');
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify({
      runId, applicationCommit: release.commit, releaseTag: release.releaseTag, archiveSha256: release.sha256,
      clrnCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
      sourceSha256: sources,
      backendVersion: '正常请求透传 staging；入座故障经过固定原版网关与本机真实 HTTP 5xx，版本另见 gateway.json',
    }, null, 2));
    console.log(`本轮证据：e2e/test-results/api-5xx/${runId}`);
    return await execute({ ...process.env, TESTING_API_TOKEN: token, CLRN_5XX_RUN_ID: runId,
      CLRN_RELEASE_WEB_ROOT: release.webRoot, CLRN_EXPECTED_APPLICATION_COMMIT: release.commit,
      CLRN_RELEASE_TAG: release.releaseTag });
  } finally { await rm(dirname(release.webRoot), { recursive: true, force: true }); }
}

main().then(/** 保留真实产品测试结果。
 * @param code - 定向复现退出码。 */ code => { process.exitCode = code; }).catch(/** 启动异常不输出可能含凭据的底层诊断。 */ () => {
  console.error('5xx 复现启动失败；检查固定 Release、测试令牌、账号池及依赖。');
  process.exitCode = 1;
});
