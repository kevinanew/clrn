import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../e2e/helpers/mitmproxy-session';
import { visualNetworkRouter } from './network-routes';
import { adb } from './device';

/**
 * 在专用模拟器安装本轮 CA，并只把该模拟器的流量转入隔离代理。
 * @param directory - 本轮代理的临时配置目录。
 * @param server - 主机回环地址上的代理 URL。
 */
async function configureProxy(directory: string, server: string): Promise<void> {
  if (adb('shell', 'getprop', 'ro.kernel.qemu').trim() !== '1') throw new Error('代理只能配置到专用模拟器。');
  try { adb('root'); }
  catch (error) {
    // adbd 切换为 root 会主动断开连接；仅容许该断连，并在重连后验证真实权限。
    if (!/closed|offline|device .* not found/.test(String(error))) throw error;
  }
  adb('wait-for-device');
  if (adb('shell', 'id', '-u').trim() !== '0') throw new Error('专用模拟器未成功切换 root，不能安装代理证书。');
  const certificate = path.join(directory, 'mitmproxy-ca-cert.pem');
  const hash = execFileSync('openssl', ['x509', '-in', certificate, '-subject_hash_old', '-noout'], { encoding: 'utf8' }).trim();
  if (!/^[a-f\d]{8}$/.test(hash)) throw new Error('无效代理证书 hash。');
  adb('push', certificate, `/data/local/tmp/${hash}.0`);
  adb('push', path.join(__dirname, 'trust-proxy.sh'), '/data/local/tmp/clrn-trust-proxy.sh');
  adb('shell', 'sh', '/data/local/tmp/clrn-trust-proxy.sh', `/data/local/tmp/${hash}.0`);
  const port = new URL(server).port;
  adb('reverse', `tcp:${port}`, `tcp:${port}`);
  adb('shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${port}`);
}

/**
 * 删除本轮转发；adbd 重连后已被移除的端口等同于清理成功。
 * @param port - 本轮独占的代理端口。
 */
function removeReverse(port: string): void {
  try { adb('reverse', '--remove', `tcp:${port}`); }
  catch (error) {
    if (!String(error).includes(`listener 'tcp:${port}' not found`)) throw error;
  }
}

/**
 * 复用 Web 网络夹具和代理生命周期；真实认证与未声明的接口仍访问 staging。
 * @param task - 在已准备的模拟器网络环境内运行测试。
 * @param records - 战绩开关或要复用的 Web 玩法代理。
 */
export async function withAndroidProxy<T>(task: (proxy: Mitmproxy) => Promise<T>, records: boolean | 'texas-holdem' | 'zhajinhua' = false): Promise<T> {
  const route = await visualNetworkRouter({ realPrivateRoom: typeof records === 'string', recordFixtures: records === true });
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== token) { response.writeHead(403).end(); return; }
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { url } = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(await route(url)));
    } catch {
      response.writeHead(500).end('Invalid fixture request');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('夹具服务启动失败。');
  const previousProxy = adb('shell', 'settings', 'get', 'global', 'http_proxy').trim();
  let proxyPort: string | undefined;
  try {
    return await withMitmproxy(task, {
      addonPath: path.join(__dirname, 'proxy-addon.py'),
      environment: { ...process.env, ANDROID_RECORDS: String(records === true),
        ANDROID_GAME: typeof records === 'string' ? records : '', ANDROID_FIXTURE_TOKEN: token,
        ANDROID_FIXTURE_URL: `http://127.0.0.1:${address.port}/` },
      /**
       * 将本轮临时证书和端口配置到专用模拟器。
       * @param directory - 代理临时目录。
       * @param proxy - 本轮代理连接。
       */
      prepare: async (directory, proxy) => {
        proxyPort = new URL(proxy.server).port;
        await configureProxy(directory, proxy.server);
      },
    });
  } finally {
    try {
      adb('shell', 'settings', 'put', 'global', 'http_proxy', previousProxy === 'null' ? ':0' : previousProxy);
    } finally {
      try {
        if (proxyPort) removeReverse(proxyPort);
      }
      finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  }
}
