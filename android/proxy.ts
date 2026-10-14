import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
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
  adb('root');
  adb('wait-for-device');
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
 * 复用 Web 网络夹具和代理生命周期；真实认证与未声明的接口仍访问 staging。
 * @param task - 在已准备的模拟器网络环境内运行测试。
 */
export async function withAndroidProxy<T>(task: () => Promise<T>): Promise<T> {
  const route = await visualNetworkRouter();
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
      environment: { ...process.env, ANDROID_FIXTURE_TOKEN: token,
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
    adb('shell', 'settings', 'put', 'global', 'http_proxy', previousProxy === 'null' ? ':0' : previousProxy);
    if (proxyPort) adb('reverse', '--remove', `tcp:${proxyPort}`);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
