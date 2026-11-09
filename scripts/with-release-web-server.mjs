/** 在测试命令执行期间托管指定 Release；向全部子进程传递同一地址并在结束时清理。 */
import { requestFailure, requestFailureReason, safeDiagnosticReason } from './request-failure.cjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { releaseDiagnosticDirectory, releaseDiagnosticWriter } from './release-diagnostics.mjs';
import { startReleaseWebServer, verifyBuildVersion } from './release-web-server.mjs';

/**
 * 只保存 CI 提供的构建及运行身份，不保存命令行或连接环境。
 * @param environment - 本轮任务的环境变量。
 */
function releaseIdentity(environment) {
  const fields = { applicationCommit: ['CLRN_EXPECTED_APPLICATION_COMMIT', 'unavailable'],
    releaseTag: ['CLRN_RELEASE_TAG', 'unavailable'], runId: ['GITHUB_RUN_ID', 'local'],
    runAttempt: ['GITHUB_RUN_ATTEMPT', '1'], testCommit: ['GITHUB_SHA', 'local'], job: ['GITHUB_JOB', 'local'] };
  return { event: 'release.identity', observedAt: Date.now(), source: 'release-static',
    ...Object.fromEntries(Object.entries(fields).map(/** 保持每个身份字段的原始回退值。
     * @param entry - 输出字段、环境变量名与回退值。 */ ([key, [variable, fallback]]) => [key, environment[variable] || fallback])) };
}

/**
 * 托管已校验的构建并运行完整测试命令，覆盖登录态采集和 Playwright 分片。
 * @param command - 待执行程序及参数。
 * @param environment - 含构建目录和提交编号的进程环境。
 */
export async function runWithReleaseWebServer(command, environment = process.env) {
  validateReleaseCommand(command, environment);
  const persistentRoot = releasePersistentRoot(environment);
  const persistentDirectory = path.join(persistentRoot, `release-${randomUUID()}`);
  const record = releaseDiagnosticWriter(releaseDiagnosticDirectory(command), persistentDirectory);
  record(releaseIdentity(environment));
  const service = await startVerifiedRelease(environment, record);
  const { server, serverId, baseUrl } = service;
  return runReleaseCommand(command, environment, { server, serverId, baseUrl, record, persistentDirectory });
}

/** 校验入口版本并记录服务启动失败。
 * @param environment - 进程环境。
 * @param record - 诊断出口。 */
async function startVerifiedRelease(environment, record) {
  try {
    await verifyBuildVersion(environment.CLRN_RELEASE_WEB_ROOT, environment.CLRN_EXPECTED_APPLICATION_COMMIT);
    return await startReleaseWebServer(environment.CLRN_RELEASE_WEB_ROOT, { record });
  } catch (error) {
    record({ event: 'release.start-error', observedAt: Date.now(), source: 'release-static', reason: safeDiagnosticReason(error) });
    throw error;
  }
}

/** 运行命令并在取消、失败或正常退出时关闭原服务。
 * @param command - 原命令及参数。
 * @param environment - 进程环境。
 * @param service - 本轮服务与诊断资源。 */
async function runReleaseCommand(command, environment, { server, serverId, baseUrl, record, persistentDirectory }) {
  console.log('Release 静态服务已启动：source=release-static');
  let child;
  let terminationTimer;
  /**
   * 将取消信号传递给整个测试进程组，避免留下浏览器和登录态采集进程。
   * @param signal - 父进程收到的结束信号。
   */
  function terminate(signal) {
    const pid = childPid(child);
    if (!pid) return;
    record({ event: 'release.command-signal', observedAt: Date.now(), source: 'release-static', signal });
    signalGroup(pid, signal);
    terminationTimer ||= setTimeout(/** 强制结束未响应取消的子进程。 */ () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 子进程可能已结束。 */ }
    }, 5000);
  }
  const interrupt = /** 转发中断信号。 */ () => terminate('SIGINT');
  const shutdown = /** 转发终止信号。 */ () => terminate('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', shutdown);
  try {
    await verifyReleaseReadiness(baseUrl);
    record({ event: 'release.command-start', observedAt: Date.now(), source: 'release-static' });
    child = spawn(command[0], command.slice(1), { stdio: 'inherit', detached: true,
      env: { ...environment, CLRN_DIAGNOSTIC_SESSION: persistentDirectory,
        CLRN_RELEASE_WEB_URL: baseUrl, CLRN_RELEASE_SERVER_ID: serverId, VISUAL_BASE_URL: baseUrl,
        E2E_STAGING_URL: baseUrl, E2E_INTERACTION_BASE_URL: baseUrl,
        E2E_EXPECT_BUILD_SHA: environment.CLRN_EXPECTED_APPLICATION_COMMIT } });
    return await new Promise(/**
     * 保留测试退出码，取消或异常退出不得误报成功。
     * @param resolve - 命令结束回调。
     * @param reject - 命令启动失败回调。
     */ (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', /**
       * 返回真实退出码或取消状态。
       * @param code - 子进程退出码。
       * @param signal - 退出信号。
       */ (code, signal) => {
        record({ event: 'release.command-end', observedAt: Date.now(), source: 'release-static', code, signal });
        resolve(code ?? 1);
      });
    });
  } catch (error) {
    record({ event: 'release.command-error', observedAt: Date.now(), source: 'release-static', reason: safeDiagnosticReason(error) });
    throw error;
  } finally {
    terminate('SIGTERM');
    clearTimeout(terminationTimer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', shutdown);
    server.closeAllConnections();
    await new Promise(/**
     * 等待端口释放。
     * @param resolve - 服务停止回调。
     */ resolve => server.close(resolve));
    record({ event: 'release.stopped', observedAt: Date.now(), source: 'release-static' });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWithReleaseWebServer(process.argv.slice(2)).then(/**
   * 将测试结果传给持续集成。
   * @param code - 测试退出码。
   */ code => { process.exitCode = code; }).catch(/**
   * 输出不含凭据的失败原因。
   * @param error - 启动或执行失败。
   */ error => { console.error(`Release 测试命令失败：operation=release-test-command ${safeDiagnosticReason(error)}`); process.exitCode = 1; });
}

/** 在创建诊断或服务器前验证启动输入。
 * @param command - 原测试命令。
 * @param environment - 进程环境。 */
function validateReleaseCommand(command, environment) {
  if (!command.length || !environment.CLRN_RELEASE_WEB_ROOT) throw new Error('缺少测试命令或已校验的 Release 目录');
}

/** 使用既有持久化目录回退策略。
 * @param environment - 进程环境。 */
function releasePersistentRoot(environment) {
  return environment.CLRN_DIAGNOSTICS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.ci-diagnostics');
}

/** 安全读取可能尚未创建的子进程编号。
 * @param child - 子进程句柄。 */
function childPid(child) { return child?.pid; }

/** 已退出的进程组无须再次结束。
 * @param pid - 子进程编号。
 * @param signal - 原始结束信号。 */
function signalGroup(pid, signal) { try { process.kill(-pid, signal); } catch { /* 子进程可能已结束。 */ } }

/** 就绪探测保留真实请求、超时和错误传播。
 * @param baseUrl - 本轮回环静态服务。 */
async function verifyReleaseReadiness(baseUrl) {
  const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) })
    .catch(/** 将发布资源就绪探测失败转换为安全的请求诊断。
 * @param error - 当前操作抛出的错误。 */ error => { throw requestFailure('release-readiness', requestFailureReason(error)); });
  if (!response.ok) throw requestFailure('release-readiness', 'http-error', response.status);
  await response.body.cancel().catch(/** 将就绪响应取消失败转换为带实际状态的正文读取诊断。 */ () => { throw requestFailure('release-readiness', 'body-read-failed', response.status); });
}
