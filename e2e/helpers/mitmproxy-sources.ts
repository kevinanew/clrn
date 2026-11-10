/** 从既有入口的真实节点资料和本轮发布包生成确切来源，不保存连接默认值。 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { metadataHosts } from './mitmproxy-metadata';
import { stagingUserOrigin } from '../cases/_shared/test-user';

/**
 * 校验运行输入的来源，错误信息不得包含私有地址。
 * @param value - 只包含协议、主机和可选端口的地址。
 */
function origin(value: string): string {
  try {
    const url = new URL(value);
    if (isOriginUrl(url)) return url.origin;
  } catch { /* 统一报告，不附带原始输入。 */ }
  throw new Error('laiwan_proxy 来源配置无效');
}

/**
 * 读取当前发布包反馈组件的 staging 分支；没有发布包时必须明确提供来源。
 * @param environment - 当前发布服务器提供的目录和可选来源。
 */
async function feedbackOrigin(environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (environment.MITMPROXY_FEEDBACK_ORIGIN) return origin(environment.MITMPROXY_FEEDBACK_ORIGIN);
  if (!environment.CLRN_RELEASE_WEB_ROOT) return undefined;
  return releaseFeedbackOrigin(environment.CLRN_RELEASE_WEB_ROOT);
}

/**
 * 只接受无认证、路径及查询的 HTTPS 来源。
 * @param url - 已解析来源。
 */
function isOriginUrl(url: URL): boolean {
  return [url.protocol === 'https:', !url.username, !url.password, url.pathname === '/', !url.search, !url.hash].every(Boolean);
}

/**
 * 从单个反馈组件行读取 staging 分支。
 * @param source - 当前发布脚本。
 */
function feedbackAddress(source: string): string | undefined {
  const component = source.split('\n').find(/** 只定位已登记的反馈组件。
   * @param line - 脚本行。 */ line => line.includes('testID:"feedback-user-report-screen"'));
  return component?.match(/isStagingEnvironment\(\)\?'(https:\/\/[^']+)'/)?.[1];
}

/**
 * 读取匹配的发布脚本，不尝试解析其他文件。
 * @param directory - 发布脚本目录。
 * @param file - 目录项。
 */
async function feedbackInFile(directory: string, file: string): Promise<string | undefined> {
  if (!/^index-.*\.js$/.test(file)) return undefined;
  return feedbackAddress(await readFile(path.join(directory, file), 'utf8'));
}

/**
 * 按原有目录顺序寻找第一个可识别的反馈入口。
 * @param root - 本轮发布包目录。
 */
async function releaseFeedbackOrigin(root: string): Promise<string> {
  const directory = path.join(root, '_expo/static/js/web');
  for (const file of await readdir(directory)) {
    const address = await feedbackInFile(directory, file);
    if (address) return origin(new URL(address).origin);
  }
  throw new Error('本轮发布包未提供可识别的 laiwan_proxy 反馈来源，请明确提供运行输入');
}

const sources = new Map<string, Promise<NodeJS.ProcessEnv>>();

/**
 * 只读请求真实 metadata，按返回的确切节点配置代理；不生成或修改 metadata 和健康响应。
 * @param environment - 本轮环境；离线回归通过明确主机列表与真实服务隔离。
 */
export async function mitmproxySources(environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (environment.MITMPROXY_API_HOSTS !== undefined) return environment;
  const base = sourceOrigin(environment);
  const key = JSON.stringify([base, environment.CLRN_RELEASE_WEB_ROOT, environment.MITMPROXY_FEEDBACK_ORIGIN]);
  const pending = pendingSources(key, base, environment);
  try { return { ...environment, ...await pending }; } catch (error) {
    // 当前调用仍然失败且不重试；后续独立初始化不能永久复用已经失败的结果。
    removeFailedSources(key, pending);
    throw error;
  }
}

/**
 * 选择运行输入或既有 staging 入口。
 * @param environment - 当前环境。
 */
function sourceOrigin(environment: NodeJS.ProcessEnv): string {
  return origin(environment.VISUAL_API_BASE_URL || stagingUserOrigin);
}

/**
 * 共享同轮初始化；失败后由调用方清除，不自动重试。
 * @param key - 来源缓存键。
 * @param base - 已校验入口。
 * @param environment - 当前运行输入。
 */
function pendingSources(key: string, base: string, environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  let pending = sources.get(key);
  if (!pending) {
    pending = discoverSources(base, environment);
    sources.set(key, pending);
  }
  return pending;
}

/**
 * 顺序读取真实节点及发布包反馈来源。
 * @param base - 已校验入口。
 * @param environment - 当前运行输入。
 */
async function discoverSources(base: string, environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const hosts = await metadataHosts(base);
  const feedback = await feedbackOrigin(environment);
  return { MITMPROXY_API_HOSTS: JSON.stringify(hosts), MITMPROXY_FEEDBACK_ORIGIN: feedback };
}

/**
 * 只清除本次失败对应的缓存，不删除后续独立初始化。
 * @param key - 来源键。
 * @param pending - 本次共享请求。
 */
function removeFailedSources(key: string, pending: Promise<NodeJS.ProcessEnv>): void {
  if (sources.get(key) === pending) sources.delete(key);
}
