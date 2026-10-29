/** 场景控制只传逻辑名称、实体归属和操作阶段，响应全部由 Python 生成。 */
import { Mitmproxy } from './mitmproxy-client';

// 这里只按对象身份关联，不调用浏览器接口；避免跨子项目解析不同版本的 Playwright 类型。
const contexts = new WeakMap<object, Mitmproxy>();

/**
 * 关联已使用代理地址创建的上下文，避免再开响应桥接服务。
 * @param context - 当前隔离浏览器上下文。
 * @param proxy - 同一上下文使用的本机代理。
 */
export function bindScenarioProxy(context: object, proxy: Mitmproxy): void {
  contexts.set(context, proxy);
}

/**
 * 获取当前上下文的认证场景控制客户端；缺失时明确失败。
 * @param context - 使用代理的上下文。
 */
export function scenarioProxy(context: object): Mitmproxy {
  const proxy = contexts.get(context);
  if (!proxy) throw new Error('当前上下文未绑定 Python 场景代理');
  return proxy;
}

/**
 * 选择单一网络场景或进入该场景的下一阶段。
 * @param context - 当前隔离上下文。
 * @param name - Python 中登记的场景名称。
 * @param parameters - 实体标识或场景阶段，不包含响应内容。
 */
export function selectScenario(context: object, name: string,
  parameters: { userId?: string; roomId?: string; phase?: string } = {}): Promise<unknown> {
  return scenarioProxy(context).command('fixtures/select', { name, ...parameters });
}

/**
 * 读取不含凭据和真实用户标识的场景命中记录。
 * @param context - 当前隔离上下文。
 */
export function scenarioStatus(context: object): Promise<{
  requests: number; held: number; spins: number; observed: string[]; cursors: (string | null)[];
}> {
  return scenarioProxy(context).command('fixtures/status');
}
