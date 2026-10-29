/** 从既有入口的真实节点资料和本轮发布包生成确切来源，不保存连接默认值。 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { stagingUserOrigin } from '../cases/_shared/test-user';

/**
 * 校验运行输入的来源，错误信息不得包含私有地址。
 * @param value - 只包含协议、主机和可选端口的地址。
 */
function origin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* 统一报告，不附带原始输入。 */ }
  throw new Error('laiwan_prd 来源配置无效');
}

/**
 * 读取当前发布包反馈组件的 staging 分支；没有发布包时必须明确提供来源。
 * @param environment - 当前发布服务器提供的目录和可选来源。
 */
async function feedbackOrigin(environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (environment.MITMPROXY_FEEDBACK_ORIGIN) return origin(environment.MITMPROXY_FEEDBACK_ORIGIN);
  if (!environment.CLRN_RELEASE_WEB_ROOT) return undefined;
  const directory = path.join(environment.CLRN_RELEASE_WEB_ROOT, '_expo/static/js/web');
  for (const file of await readdir(directory)) {
    if (!/^index-.*\.js$/.test(file)) continue;
    const source = await readFile(path.join(directory, file), 'utf8');
    const component = source.split('\n').find(line => line.includes('testID:"feedback-user-report-screen"'));
    const address = component?.match(/isStagingEnvironment\(\)\?'(https:\/\/[^']+)'/)?.[1];
    if (address) return origin(new URL(address).origin);
  }
  throw new Error('本轮发布包未提供可识别的 laiwan_prd 反馈来源，请明确提供运行输入');
}

const sources = new Map<string, Promise<NodeJS.ProcessEnv>>();

/**
 * 只读请求真实 metadata，按返回的确切节点配置代理；不生成或修改 metadata 和健康响应。
 * @param environment - 本轮环境；离线回归通过明确主机列表与真实服务隔离。
 */
export async function mitmproxySources(environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (environment.MITMPROXY_API_HOSTS !== undefined) return environment;
  const base = origin(environment.VISUAL_API_BASE_URL || stagingUserOrigin);
  const key = JSON.stringify([base, environment.CLRN_RELEASE_WEB_ROOT, environment.MITMPROXY_FEEDBACK_ORIGIN]);
  let pending = sources.get(key);
  if (!pending) {
    pending = (async () => {
      let hosts: string[];
      try {
        const response = await fetch(`${base}/public/v13/metadata/servers`, {
          redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error('HTTP 响应失败');
        const body = await response.json();
        if (body?.ok !== true || !body.result?.servers || typeof body.result.servers !== 'object') {
          throw new Error('节点资料无效');
        }
        const servers = body.result.servers;
        const names = Array.isArray(servers) ? servers : Object.keys(servers);
        if (!names.length || !names.every((name: unknown) => typeof name === 'string'
          && /^[a-zA-Z0-9.-]+$/.test(name))) throw new Error('节点主机无效');
        hosts = [...new Set([new URL(base).hostname, ...names as string[]])];
      } catch {
        // 网络异常可能含连接资料；禁止把底层异常写入公开报告。
        throw new Error('读取 laiwan_prd 真实节点资料失败，未启动响应夹具');
      }
      const feedback = await feedbackOrigin(environment);
      return { MITMPROXY_API_HOSTS: JSON.stringify(hosts), MITMPROXY_FEEDBACK_ORIGIN: feedback };
    })();
    sources.set(key, pending);
  }
  return { ...environment, ...await pending };
}
