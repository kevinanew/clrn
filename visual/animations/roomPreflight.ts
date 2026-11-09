/** 只在完整代理记录证明建房写入未发出时，允许恢复入口。 */
export type ProxySnapshot = { events: unknown[]; dropped: number };
type ProxyEvent = Record<string, unknown>;

/**
 * 检查本次建房是否仅完成了真实预检，拒绝写入、RPC、丢失记录及未完成预检。
 * @param before - 建房前的代理记录。
 * @param after - 建房失败后的代理记录。
 */
export function completedRoomPreflight(before: ProxySnapshot, after: ProxySnapshot): boolean {
  if (!completeHistory(before, after)) return false;
  const events = after.events.slice(before.events.length) as ProxyEvent[];
  if (events.some(isWrite)) return false;
  return completedRequests(events);
}

/**
 * 不接受丢失、缩短或改写的历史记录。
 * @param before - 原记录。
 * @param after - 当前记录。
 * @returns 是否保留完整前缀并有新增事件。
 */
function completeHistory(before: ProxySnapshot, after: ProxySnapshot): boolean {
  if (before.dropped !== 0 || after.dropped !== 0) return false;
  return extendsHistory(before, after);
}

/**
 * 检查新记录是否严格扩展旧记录。
 * @param before - 原记录。
 * @param after - 当前记录。
 * @returns 是否具有完整前缀。
 */
function extendsHistory(before: ProxySnapshot, after: ProxySnapshot): boolean {
  return after.events.length > before.events.length
    && JSON.stringify(after.events.slice(0, before.events.length)) === JSON.stringify(before.events);
}

/**
 * 逐字段匹配固定代理事件，不改变缺失字段的比较语义。
 * @param event - 当前事件。
 * @param expected - 必需的事件字段。
 * @returns 是否全部匹配。
 */
function matches(event: ProxyEvent, expected: ProxyEvent): boolean {
  return Object.entries(expected).every(/** 比较当前字段。
   * @param entry - 字段和值。 */ ([key, value]) => event[key] === value);
}

/**
 * 检查可能产生写入的 RPC 与支付操作。
 * @param event - 当前事件。
 * @returns 是否发现禁止重试的写入。
 */
function isWrite(event: ProxyEvent): boolean {
  return matches(event, { event: 'proxy.websocket-command', messageType: 'rpc' }) || isPaymentWrite(event);
}

/**
 * OPTIONS 之外的支付接口请求均禁止自动恢复。
 * @param event - 当前事件。
 * @returns 是否为实际支付请求。
 */
function isPaymentWrite(event: ProxyEvent): boolean {
  return event.path === '/v3/pay_action/do' && event.method !== 'OPTIONS';
}

/**
 * 每项真实上游预检均须具有同请求的 204 响应。
 * @param events - 本次新增事件。
 * @returns 是否所有预检均已完成。
 */
function completedRequests(events: ProxyEvent[]): boolean {
  const requests = events.filter(/** 选取真实上游预检请求。
   * @param event - 当前事件。 */ event => matches(event,
    { event: 'proxy.request', path: '/v3/pay_action/do', method: 'OPTIONS', source: 'upstream' }));
  return requests.length > 0 && requests.every(/** 确认预检响应归属和成功状态。
   * @param request - 当前预检。 */ request => events.some(/** 匹配同一请求的上游响应。
    * @param event - 当前响应。 */ event => matches(event,
     { event: 'proxy.response', requestId: request.requestId, source: 'upstream', status: 204 })));
}
