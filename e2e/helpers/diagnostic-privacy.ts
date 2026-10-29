/** 只修改日志副本；连接资料使用 laiwan_prd 逻辑标签，不影响真实请求。 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import diagnosticPaths from '../mitmproxy/data/diagnostic-paths.json';

const pathTemplates = diagnosticPaths.map(path => ({ path, segments: path.split('/') }));

/**
 * 只输出已登记的操作模板，实体段、未知入口和查询参数都不进入日志。
 * @param value - 不可信的请求路径或代理历史字段。
 */
export function diagnosticPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '[未知接口]';
  const segments = value.split(/[?#]/)[0].split('/');
  const match = pathTemplates.find(template => template.segments.length === segments.length
    && template.segments.every((segment, index) => segment.startsWith('{')
      ? Boolean(segments[index]) && !['.', '..'].includes(segments[index])
      : segment === segments[index]));
  return match?.path ?? '[未知接口]';
}

/**
 * 使用与 Python 代理相同的主机散列，关联候选、HTTP 与 WebSocket。
 * @param address - 域名、完整地址或已脱敏的节点标签。
 */
export function diagnosticNode(address: string): string {
  if (/^laiwan_prd-[a-f0-9]{12}$/.test(address)) return address;
  try {
    const host = new URL(address.includes('://') ? address : `https://${address}`).hostname.replace(/^\[|\]$/g, '');
    return `laiwan_prd-${createHash('sha256').update(host).digest('hex').slice(0, 12)}`;
  } catch { return '[未知节点]'; }
}

/**
 * 清理错误、地址和界面说明中的完整连接入口、裸地址与常见认证字段。
 * @param value - 待展示的文本。
 */
export function diagnosticText(value: unknown): string {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s,"'}]+/gi, 'Bearer [已隐藏]')
    .replace(/((?:access_token|refresh_token|authorization|password|cookie|token)["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi, '$1[已隐藏]')
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"'`)]+/gi, diagnosticNode)
    .replace(/\[[0-9a-f:.]+\](?::\d+)?|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/gi, '[地址已隐藏]')
    .replace(/(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]+/gi, match => isIP(match) ? '[地址已隐藏]' : match)
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b(?::\d+)?(?:\/[^\s<>"'`),;]*)?/gi, diagnosticNode)
    .slice(0, 2000);
}

const allowedFields = new Set(['event', 'source', 'node', 'path', 'method', 'status', 'requestId',
  'connectionId', 'reason', 'code', 'elapsedMs', 'timeoutMs', 'cacheAgeMs', 'candidates', 'selected',
  'excluded', 'before', 'after', 'phase', 'target', 'roomId', 'attempt', 'limit', 'count', 'remaining',
  'backendDelay', 'serverLoad', 'outcome', 'observedAt', 'messageType', 'commandId', 'channel', 'dropped']);
const nodeFields = new Set(['node', 'candidates', 'selected', 'excluded', 'before', 'after']);

/**
 * 白名单复制外部诊断事件，拒绝凭据、请求正文及任意嵌套对象。
 * @param value - 应用或代理返回的事件。
 */
export function diagnosticFields(value: unknown): Record<string, string | number | boolean | string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowedFields.has(key)) continue;
    // 事件是逻辑阶段，不能把任意主机或自由文本作为事件名写入日志。
    if (key === 'event') {
      result[key] = typeof item === 'string'
        && /^(?:application|http|nodes?|page|probe|proxy|test|ui|websocket)\.[a-z][a-z-]*$/.test(item)
        ? item : 'application.event';
      continue;
    }
    if (key === 'path') {
      result[key] = diagnosticPath(item);
      continue;
    }
    const sanitize = nodeFields.has(key) ? diagnosticNode : diagnosticText;
    if (typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean') result[key] = item;
    else if (typeof item === 'string') result[key] = sanitize(item);
    else if (Array.isArray(item)) result[key] = item.slice(0, 100).filter(entry => typeof entry === 'string').map(sanitize);
  }
  return result;
}
