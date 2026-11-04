/** 只在完整代理记录证明建房写入未发出时，允许恢复入口。 */
export type ProxySnapshot = { events: unknown[]; dropped: number };

/**
 * 检查本次建房是否仅完成了真实预检，拒绝写入、RPC、丢失记录及未完成预检。
 * @param before - 建房前的代理记录。
 * @param after - 建房失败后的代理记录。
 */
export function completedRoomPreflight(before: ProxySnapshot, after: ProxySnapshot): boolean {
  if (before.dropped !== 0 || after.dropped !== 0 || after.events.length <= before.events.length
    || JSON.stringify(after.events.slice(0, before.events.length)) !== JSON.stringify(before.events)) return false;
  const events = after.events.slice(before.events.length) as Record<string, unknown>[];
  if (events.some(/** 判断房间预检是否意外触发 WebSocket RPC 或实际支付请求。
 * @param event - 当前触发的事件。 */ event => event.event === 'proxy.websocket-command' && event.messageType === 'rpc'
    || event.path === '/v3/pay_action/do' && event.method !== 'OPTIONS')) return false;
  const requests = events.filter(/** 选取真实上游处理的支付接口 OPTIONS 预检请求。
 * @param event - 当前触发的事件。 */ event => event.event === 'proxy.request'
    && event.path === '/v3/pay_action/do' && event.method === 'OPTIONS' && event.source === 'upstream');
  return requests.length > 0 && requests.every(/** 确认每个支付预检请求都具有对应的上游 204 响应。
 * @param request - 当前发出的接口请求。 */ request => events.some(/** 按请求 ID 查找该预检请求的上游成功响应。
 * @param event - 当前触发的事件。 */ event =>
    event.event === 'proxy.response' && event.requestId === request.requestId
    && event.source === 'upstream' && event.status === 204));
}
