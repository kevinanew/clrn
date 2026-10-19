/** 诊断输出统一隐藏共享域名后缀和认证参数；只修改日志副本，不修改真实请求。 */

/**
 * 清理错误、地址和界面说明中的域名后缀与常见认证字段。
 * @param value - 待展示的文本。
 */
export function diagnosticText(value: unknown): string {
  return String(value ?? '').replace(/\b(?:https?|wss?):\/\/[^\s<>"'`)]+/gi, match => {
    try {
      const url = new URL(match);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch { return '[地址已隐藏]'; }
  }).replace(/\.?shafayouxi\.com\b/gi, '')
    .replace(/\bBearer\s+[^\s,"'}]+/gi, 'Bearer [已隐藏]')
    .replace(/((?:access_token|refresh_token|authorization|password|cookie|token)["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi, '$1[已隐藏]')
    .slice(0, 2000);
}

/**
 * 使用同一节点名称关联候选、HTTP 与 WebSocket，保留节点及环境。
 * @param address - 域名或完整地址。
 */
export function diagnosticNode(address: string): string {
  try { return diagnosticText(new URL(address.includes('://') ? address : `https://${address}`).hostname); }
  catch { return '[未知节点]'; }
}

const allowedFields = new Set(['event', 'source', 'node', 'path', 'method', 'status', 'requestId',
  'connectionId', 'reason', 'code', 'elapsedMs', 'timeoutMs', 'cacheAgeMs', 'candidates', 'selected',
  'excluded', 'before', 'after', 'phase', 'target', 'roomId', 'attempt', 'limit', 'count', 'remaining',
  'backendDelay', 'serverLoad', 'outcome', 'observedAt', 'messageType', 'commandId', 'channel', 'dropped']);

/**
 * 白名单复制外部诊断事件，拒绝凭据、请求正文及任意嵌套对象。
 * @param value - 应用或代理返回的事件。
 */
export function diagnosticFields(value: unknown): Record<string, string | number | boolean | string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowedFields.has(key)) continue;
    if (typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean') result[key] = item;
    else if (typeof item === 'string') result[key] = diagnosticText(item);
    else if (Array.isArray(item)) result[key] = item.slice(0, 100).filter(entry => typeof entry === 'string').map(diagnosticText);
  }
  return result;
}
