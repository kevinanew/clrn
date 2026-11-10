/** 只修改日志副本；连接资料使用 laiwan_proxy 逻辑标签，不影响真实请求。 */
import { safeDiagnosticReason } from '../../scripts/request-failure.cjs';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import diagnosticPaths from '../mitmproxy/data/diagnostic-paths.json';

const pathTemplates = diagnosticPaths.map(/** 预拆分允许记录的接口模板，供请求路径逐段匹配。
 * @param path - 当前操作使用的 path。 */ path => ({ path, segments: path.split('/') }));

/**
 * 只输出已登记的操作模板，实体段、未知入口和查询参数都不进入日志。
 * @param value - 不可信的请求路径或代理历史字段。
 */
export function diagnosticPath(value: unknown): string {
  if (!isRequestPath(value)) return '[未知接口]';
  const segments = value.split(/[?#]/)[0].split('/');
  const match = pathTemplates.find(/** 按路径分段结构查找匹配的脱敏模板。
 * @param template - 当前操作使用的 template。 */ template => template.segments.length === segments.length
    && template.segments.every(/** 校验固定路径段与占位段，拒绝空值及相对路径段。
 * @param segment - 当前操作使用的 segment。
 * @param index - 当前条目在集合中的位置。 */ (segment, index) => matchesPathSegment(segment, segments[index])));
  return match ? match.path : '[未知接口]';
}

/**
 * 使用与 Python 代理相同的主机散列，关联候选、HTTP 与 WebSocket。
 * @param address - 域名、完整地址或已脱敏的节点标签。
 */
export function diagnosticNode(address: string): string {
  if (/^laiwan_proxy-[a-f0-9]{12}$/.test(address)) return address;
  try {
    const host = new URL(nodeAddress(address)).hostname.replace(/^\[|\]$/g, '');
    return `laiwan_proxy-${createHash('sha256').update(host).digest('hex').slice(0, 12)}`;
  } catch { return '[未知节点]'; }
}

/**
 * 清理错误、地址和界面说明中的完整连接入口、裸地址与常见认证字段。
 * @param value - 待展示的文本。
 */
export function diagnosticText(value: unknown): string {
  return diagnosticFullText(value).slice(0, 2000);
}

/**
 * 使用相同脱敏规则，由持续日志出口统计长度和截断量。
 * @param value - 待展示的文本。
 */
export function diagnosticFullText(value: unknown): string {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s,"'}]+/gi, 'Bearer [已隐藏]')
    .replace(/((?:access_token|refresh_token|authorization|password|cookie|token)["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi, '$1[已隐藏]')
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"'`)]+/gi, diagnosticNode)
    .replace(/\[[0-9a-f:.]+\](?::\d+)?|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/gi, '[地址已隐藏]')
    .replace(/(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]+/gi, /** 隐藏真实 IP 地址，保留不构成地址的匹配文本。
 * @param match - 当前操作使用的 match。 */ match => isIP(match) ? '[地址已隐藏]' : match)
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b(?::\d+)?(?:\/[^\s<>"'`),;]*)?/gi, diagnosticNode);
}

const allowedFields = new Set(['event', 'source', 'node', 'path', 'method', 'status', 'requestId',
  'connectionId', 'upstreamConnectionId', 'releaseRequestId', 'operation', 'response', 'originMatch', 'upstreamMatch', 'fixtureHit', 'reason', 'code', 'elapsedMs', 'timeoutMs', 'cacheAgeMs', 'candidates', 'selected',
  'excluded', 'before', 'after', 'phase', 'target', 'roomId', 'attempt', 'limit', 'count', 'remaining',
  'backendDelay', 'serverLoad', 'outcome', 'observedAt', 'messageType', 'commandId', 'channel', 'dropped']);
const nodeFields = new Set(['node', 'candidates', 'selected', 'excluded', 'before', 'after']);

type SafeField = string | number | boolean | string[];

/**
 * 验证请求路径入口，拒绝非路径及协议相对地址。
 * @param value - 外部输入。
 */
function isRequestPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.startsWith('/') && !value.startsWith('//');
}

/**
 * 匹配固定段或非空、非相对的实体占位段。
 * @param template - 已登记的路径段。
 * @param value - 输入路径段。
 */
function matchesPathSegment(template: string, value: string): boolean {
  if (!template.startsWith('{')) return template === value;
  return Boolean(value) && !['.', '..'].includes(value);
}

/**
 * 为裸节点地址补齐解析协议。
 * @param address - 输入地址。
 */
function nodeAddress(address: string): string {
  return address.includes('://') ? address : `https://${address}`;
}

const originMatches = ['matched', 'different', 'unconfigured', 'invalid-configuration'];
const upstreamMatches = [...originMatches, 'unavailable', 'not-applicable'];

/**
 * 将连接匹配状态限制为已登记词汇。
 * @param item - 外部状态。
 * @param allowed - 此类状态允许的值。
 */
function matchStatus(item: unknown, allowed: string[]): string {
  return typeof item === 'string' && allowed.includes(item) ? item : 'unavailable';
}

/**
 * 事件只允许逻辑阶段名称。
 * @param item - 外部事件名。
 */
function eventName(item: unknown): string {
  return typeof item === 'string' && /^(?:application|http|nodes?|page|probe|proxy|test|ui|websocket)\.[a-z][a-z-]*$/.test(item)
    ? item : 'application.event';
}

const fieldSanitizers: Record<string, (item: unknown) => SafeField> = {
  /** 清理来源匹配状态。
   * @param item - 外部状态。 */
  originMatch: item => matchStatus(item, originMatches),
  /** 清理上游匹配状态。
   * @param item - 外部状态。 */
  upstreamMatch: item => matchStatus(item, upstreamMatches),
  reason: safeDiagnosticReason, event: eventName, path: diagnosticPath,
};

/**
 * 复制允许的字符串及有界字符串数组；拒绝任意嵌套对象。
 * @param item - 外部字段值。
 * @param sanitize - 字符串清理函数。
 */
function stringField(item: unknown, sanitize: (value: string) => string): SafeField | undefined {
  if (typeof item === 'string') return sanitize(item);
  if (Array.isArray(item)) return item.slice(0, 100).filter(/** 排除非字符串成员。
   * @param entry - 数组成员。 */ (entry): entry is string => typeof entry === 'string').map(sanitize);
  return undefined;
}

/**
 * 检查允许原样保存的数字与布尔值。
 * @param item - 外部字段值。
 */
function isScalar(item: unknown): item is number | boolean {
  if (typeof item === 'boolean') return true;
  return typeof item === 'number' && Number.isFinite(item);
}

/**
 * 按字段语义分发白名单清理。
 * @param key - 已允许的字段名。
 * @param item - 外部字段值。
 */
function sanitizeField(key: string, item: unknown): SafeField | undefined {
  if (Object.hasOwn(fieldSanitizers, key)) return fieldSanitizers[key](item);
  if (isScalar(item)) return item;
  return stringField(item, stringSanitizer(key));
}

/**
 * 仅接受非数组对象事件。
 * @param value - 外部诊断事件。
 */
function isEventObject(value: unknown): value is Record<string, unknown> {
  if (!value) return false;
  return typeof value === 'object' && !Array.isArray(value);
}

/**
 * 白名单复制外部诊断事件，拒绝凭据、请求正文及任意嵌套对象。
 * @param value - 应用或代理返回的事件。
 */
export function diagnosticFields(value: unknown): Record<string, SafeField> {
  if (!isEventObject(value)) return {};
  const result: Record<string, SafeField> = {};
  Object.entries(value).filter(/** 只处理白名单字段。
   * @param entry - 字段和值。 */ ([key]) => allowedFields.has(key)).forEach(/** 保留成功清理的值。
   * @param entry - 白名单字段和值。 */ ([key, item]) => {
    const safe = sanitizeField(key, item);
    if (safe !== undefined) result[key] = safe;
  });
  return result;
}

/**
 * 节点字段使用统一散列，其余文本使用文本脱敏。
 * @param key - 白名单字段。
 */
function stringSanitizer(key: string): (value: string) => string {
  return nodeFields.has(key) ? diagnosticNode : diagnosticText;
}
