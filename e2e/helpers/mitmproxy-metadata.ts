/** 以应用的只读 POST 契约发现真实节点，失败时只输出固定阶段。 */

/**
 * 创建不含私有地址的节点读取错误。
 * @param reason - 固定阶段或响应状态码。
 */
export function metadataFailure(reason: string): Error {
  return new Error(`读取 laiwan_proxy 真实节点资料失败（${reason}），未启动响应夹具`);
}

/**
 * 将超时和其他传输失败映射为固定类别。
 * @param error - 底层传输错误。
 */
function transportReason(error: unknown): string {
  return error instanceof Error && error.name === 'TimeoutError' ? '请求超时' : '传输失败';
}

/**
 * 发出既有只读请求，拒绝跳转并保留原有十五秒上限。
 * @param base - 已校验入口。
 */
async function metadataResponse(base: string): Promise<Response> {
  try {
    return await fetch(`${base}/public/v13/metadata/servers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch (error) { throw metadataFailure(transportReason(error)); }
}

/**
 * 解析真实响应，JSON 错误不携带正文。
 * @param response - 真实响应。
 */
async function metadataBody(response: Response): Promise<unknown> {
  if (!response.ok) throw metadataFailure(`HTTP ${response.status}`);
  try { return await response.json(); } catch { throw metadataFailure('JSON 解析失败'); }
}

/**
 * 提取契约中的节点字段，允许既有数组与对象两种形态。
 * @param body - 不可信的 JSON 响应。
 */
function serverField(body: any): unknown {
  if (body?.ok !== true) throw metadataFailure('节点契约无效');
  return resultServers(body.result);
}

/**
 * 拒绝缺失、空值与非对象的节点契约。
 * @param body - 不可信的响应。
 */
function serverNames(body: unknown): unknown[] {
  const servers = serverField(body);
  if (!servers || typeof servers !== 'object') throw metadataFailure('节点契约无效');
  return namesFromServers(servers);
}

/**
 * 保留数组元素或对象主机键，不读取连接资料值。
 * @param servers - 契约的服务器对象。
 */
function namesFromServers(servers: object): unknown[] {
  return Array.isArray(servers) ? servers : Object.keys(servers);
}

/**
 * 校验主机名，禁止路径与连接资料混入配置。
 * @param name - 不可信主机名。
 */
function isHostName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-zA-Z0-9.-]+$/.test(name);
}

/**
 * 读取真实节点并保留入口主机，按首次出现顺序去重。
 * @param base - 经过校验的既有入口。
 */
export async function metadataHosts(base: string): Promise<string[]> {
  const names = serverNames(await metadataBody(await metadataResponse(base)));
  if (!names.length || !names.every(isHostName)) throw metadataFailure('节点主机无效');
  return [...new Set([new URL(base).hostname, ...names as string[]])];
}

/**
 * 兼容缺失结果字段，由契约检查统一报告。
 * @param result - 外部结果对象。
 */
function resultServers(result: any): unknown {
  return result?.servers;
}
