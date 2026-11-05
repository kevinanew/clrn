import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Mitmproxy } from './mitmproxy-client';
import { startMitmdump } from './mitmproxy-process';
import { mitmproxySources } from './mitmproxy-sources';

/** 申请本机临时监听端口并关闭探测服务，返回可用于代理的端口号。 */
async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(/** 监听临时本机端口，向调用方传播监听失败。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配 mitmproxy 端口');
  await new Promise<void>(/** 等待临时端口服务关闭，并传播关闭失败。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
    server.close(/** 根据关闭结果完成或拒绝端口服务清理。
 * @param error - 当前操作抛出的错误。 */ error => error ? reject(error) : resolve());
  });
  return address.port;
}

/**
 * 测试结束或失败时先停止代理，再删除临时证书。
 * @param task - 在已准备好的上下文或代理上执行的异步任务。
 * @param options - 专用插件、进程环境和启动后的证书准备步骤；默认保持 Web 代理行为。
 */
export async function withMitmproxy<T>(task: (proxy: Mitmproxy) => Promise<T>,
  options: { addonPath?: string; environment?: NodeJS.ProcessEnv;
    prepare?: (directory: string, proxy: Mitmproxy) => Promise<void> } = {}): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'test-mitmproxy-'));
  const token = randomBytes(32).toString('hex');
  try {
    const port = await unusedPort();
    const proxy = new Mitmproxy(port, token);
    const environment = await mitmproxySources(options.environment || process.env);
    const proxyProcess = startMitmdump(port, directory, token, options.addonPath, environment);
    try {
      await proxyProcess.waitUntilReady(/** 同时探测代理状态和夹具控制入口，确认代理可以接收场景命令。 */ async () => {
        await proxy.status();
        await proxy.command('fixtures/status');
      });
      await options.prepare?.(directory, proxy);
      return await task(proxy);
    } finally {
      await proxyProcess.stop();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
