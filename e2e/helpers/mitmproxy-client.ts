import { request } from 'node:http';

const CONTROL_HOST = 'test-mitmproxy.invalid';
export type InjectableScenario = 'hall-timeout' | 'login-failure' | 'club-failure' | 'club-search-result';
type ProxyScenario = InjectableScenario | 'visual-stable';
export type ProxyStatus = {
  scenario: ProxyScenario | null;
  interceptedRequests: number;
  proxiedRequests: number;
  stabilizedRequests: number;
  clubSearchRequests?: number;
  clubDetailsRequests?: number;
};

/** 通过代理内的认证接口控制插件，不把控制 token 传入浏览器。 */
export class Mitmproxy {
  readonly server: string;

  /**
   * 绑定本轮代理连接及认证配置。
   * @param port - 本机代理监听端口。
   * @param token - 仅用于测试接口或代理控制接口的认证凭据。
   */
  constructor(private readonly port: number, private readonly token: string) {
    this.server = `http://127.0.0.1:${port}`;
  }

  /**
   * 向本机代理的认证控制接口发送命令，解析响应并传播请求失败。
   * @param endpoint - 代理控制接口的相对路径。
   * @param payload - 可选命令正文；缺失时发送 GET 请求。
   * @param timeoutMs - 控制请求的超时毫秒数。
   */
  command<T = ProxyStatus>(endpoint: string, payload?: unknown, timeoutMs = 5_000): Promise<T> {
    return new Promise(/** 发送本机代理控制请求，并将响应、超时与连接错误映射到等待结果。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
      const body = commandBody(payload);
      const host = controlHost(endpoint);
      const req = request({
        hostname: '127.0.0.1',
        port: this.port,
        path: `http://${host}/${endpoint}`,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Host: host,
          'X-E2E-Control-Token': this.token,
          'Content-Type': 'application/json',
        },
      }, /** 收集代理控制响应正文，在流结束后检查状态并解析 JSON。
 * @param response - 当前收到的接口响应。 */ response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', /** 拼接代理控制响应的数据块。
 * @param chunk - 本次读取的数据块。 */ chunk => { data += chunk; });
        response.on('error', reject);
        response.on('end', /** 响应结束后校验 HTTP 状态并解析控制结果，传播无效 JSON 错误。 */ () => {
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
      req.setTimeout(timeoutMs, /** 超时后销毁控制请求，终止无响应的代理等待。 */ () => req.destroy(new Error('mitmproxy 控制请求超时')));
      req.end(body);
    });
  }

  /** 读取当前代理场景、拦截统计及回放状态。 */
  status(): Promise<ProxyStatus> {
    return this.command('status');
  }

  /**
   * 启用指定代理场景，在目标接口注入故障或固定搜索结果。
   * @param scenario - 本次启用的代理场景。
   */
  inject(scenario: InjectableScenario): Promise<ProxyStatus> {
    return this.command('scenario', { scenario });
  }

  /** 启用视觉业务夹具；节点列表和健康探测始终透传。 */
  enableVisualFixtures(): Promise<ProxyStatus> {
    return this.command('scenario', { scenario: 'visual-stable' });
  }

  /** 清除故障注入配置，恢复代理的默认转发行为。 */
  clear(): Promise<ProxyStatus> {
    return this.command('scenario', { scenario: null });
  }
}

/**
 * 按控制接口选择保留域名，不向浏览器传递凭据。
 * @param endpoint - 控制接口路径。
 */
function controlHost(endpoint: string): string {
  return endpoint.startsWith('fixtures/') ? 'fixtures-mitmproxy.invalid' : CONTROL_HOST;
}

/**
 * 在 Promise 执行器内序列化正文，保证序列化错误仍以拒绝结果传播。
 * @param payload - 可选控制正文。
 */
function commandBody(payload: unknown): string | undefined {
  return payload === undefined ? undefined : JSON.stringify(payload);
}
