import { request } from 'node:http';

const CONTROL_HOST = 'test-mitmproxy.invalid';
export type FaultScenario = 'hall-timeout' | 'login-failure' | 'club-failure';
type ProxyScenario = FaultScenario | 'visual-stable';
export type ProxyStatus = {
  scenario: ProxyScenario | null;
  interceptedRequests: number;
  proxiedRequests: number;
  stabilizedRequests: number;
};

/** 通过代理内的认证接口控制插件，不把控制 token 传入浏览器。 */
export class Mitmproxy {
  readonly server: string;

  constructor(private readonly port: number, private readonly token: string) {
    this.server = `http://127.0.0.1:${port}`;
  }

  command<T = ProxyStatus>(endpoint: string, payload?: unknown, timeoutMs = 5_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const req = request({
        hostname: '127.0.0.1',
        port: this.port,
        path: `http://${CONTROL_HOST}/${endpoint}`,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Host: CONTROL_HOST,
          'X-E2E-Control-Token': this.token,
          'Content-Type': 'application/json',
        },
      }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`mitmproxy 控制请求失败：HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('mitmproxy 控制请求超时')));
      req.end(body);
    });
  }

  status(): Promise<ProxyStatus> {
    return this.command('status');
  }

  inject(scenario: FaultScenario): Promise<ProxyStatus> {
    return this.command('scenario', { scenario });
  }

  stabilizeVisualNetwork(): Promise<ProxyStatus> {
    return this.command('scenario', { scenario: 'visual-stable' });
  }

  clear(): Promise<ProxyStatus> {
    return this.command('scenario', { scenario: null });
  }
}
