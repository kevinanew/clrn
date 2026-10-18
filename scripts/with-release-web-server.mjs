/** 在测试命令执行期间托管指定 Release；向全部子进程传递同一地址并在结束时清理。 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startReleaseWebServer, verifyBuildVersion } from './release-web-server.mjs';

/**
 * 托管已校验的构建并运行完整测试命令，覆盖登录态采集和 Playwright 分片。
 * @param command - 待执行程序及参数。
 * @param environment - 含构建目录和提交编号的进程环境。
 */
export async function runWithReleaseWebServer(command, environment = process.env) {
  if (!command.length || !environment.CLRN_RELEASE_WEB_ROOT) throw new Error('缺少测试命令或已校验的 Release 目录');
  await verifyBuildVersion(environment.CLRN_RELEASE_WEB_ROOT, environment.CLRN_EXPECTED_APPLICATION_COMMIT);
  const { server, baseUrl } = await startReleaseWebServer(environment.CLRN_RELEASE_WEB_ROOT);
  console.log(`Release ${environment.CLRN_RELEASE_TAG || ''}：${baseUrl}`);
  let child;
  let terminationTimer;
  /**
   * 将取消信号传递给整个测试进程组，避免留下浏览器和登录态采集进程。
   * @param signal - 父进程收到的结束信号。
   */
  function terminate(signal) {
    if (!child?.pid) return;
    try { process.kill(-child.pid, signal); } catch { /* 子进程可能已结束。 */ }
    terminationTimer ||= setTimeout(/** 强制结束未响应取消的子进程。 */ () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 子进程可能已结束。 */ }
    }, 5000);
  }
  const interrupt = /** 转发中断信号。 */ () => terminate('SIGINT');
  const shutdown = /** 转发终止信号。 */ () => terminate('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', shutdown);
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Release Web Server 未就绪');
    await response.body.cancel();
    child = spawn(command[0], command.slice(1), { stdio: 'inherit', detached: true,
      env: { ...environment, CLRN_RELEASE_WEB_URL: baseUrl, VISUAL_BASE_URL: baseUrl,
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
       */ code => resolve(code ?? 1));
    });
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
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWithReleaseWebServer(process.argv.slice(2)).then(/**
   * 将测试结果传给持续集成。
   * @param code - 测试退出码。
   */ code => { process.exitCode = code; }).catch(/**
   * 输出不含凭据的失败原因。
   * @param error - 启动或执行错误。
   */ error => { console.error(error.message); process.exitCode = 1; });
}
