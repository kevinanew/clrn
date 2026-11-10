/** 将脱敏事件转换为节点统计和最近现场，不推测缺失的应用决策。 */
import { diagnosticFields, diagnosticText } from './diagnostic-privacy';
export type DiagnosticEvent = ReturnType<typeof diagnosticFields> & { event: string; observedAt: number };

type NodeRow = { probes: number; upstream: number; mocked: number; cached: number; sockets: number };
type Nodes = Map<string, NodeRow>;

/**
 * 为已识别的节点创建统计行。
 * @param nodes - 本轮节点表。
 * @param name - 事件中的候选名称。
 */
function registerNode(nodes: Nodes, name: unknown): void {
  if (typeof name !== 'string' || nodes.has(name)) return;
  nodes.set(name, { probes: 0, upstream: 0, mocked: 0, cached: 0, sockets: 0 });
}

/**
 * 将实际健康响应按来源计数。
 * @param row - 当前节点。
 * @param item - 实际响应事件。
 */
function countResponse(row: NodeRow, item: DiagnosticEvent): void {
  if (item.event !== 'proxy.response') return;
  countResponseSource(row, item);
}

/**
 * 仅按真实响应来源累计健康响应。
 * @param row - 节点统计。
 * @param item - 响应事件。
 */
function countResponseSource(row: NodeRow, item: DiagnosticEvent): void {
  if (item.source === 'upstream') row.upstream++;
  if (item.source === 'fixture') row.mocked++;
}

/**
 * 仅在 GET 健康接口上统计探测与响应。
 * @param row - 当前节点。
 * @param item - 当前事件。
 */
function countHealth(row: NodeRow, item: DiagnosticEvent): void {
  if (item.event === 'http.start') row.probes++;
  countResponse(row, item);
}

/**
 * 按事件类型累计一个节点，缓存只依据应用事件。
 * @param nodes - 节点表。
 * @param item - 当前事件。
 */
function countNode(nodes: Nodes, item: DiagnosticEvent): void {
  const row = typeof item.node === 'string' ? nodes.get(item.node) : undefined;
  if (row) countEvent(row, item);
}

/**
 * 区分健康探测、缓存和 WebSocket 尝试。
 * @param row - 节点统计。
 * @param item - 当前事件。
 */
function countEvent(row: NodeRow, item: DiagnosticEvent): void {
  if (item.path === '/node/v1/status' && item.method === 'GET') countHealth(row, item);
  countConnection(row, item);
}

/**
 * 按显式连接事件累计缓存与 socket 尝试。
 * @param row - 节点统计。
 * @param item - 当前事件。
 */
function countConnection(row: NodeRow, item: DiagnosticEvent): void {
  if (item.event === 'probe.cache') row.cached++;
  if (item.event === 'websocket.start') row.sockets++;
}

/**
 * 注册单条事件携带的节点及候选，再累计已归属的事件。
 * @param nodes - 本轮统计表。
 * @param item - 当前事件。
 */
function collectNode(nodes: Nodes, item: DiagnosticEvent): void {
  const candidates = Array.isArray(item.candidates) ? item.candidates : [];
  for (const name of [item.node, ...candidates]) registerNode(nodes, name);
  countNode(nodes, item);
}

/**
 * 输出应用事件是否可用，缺失时保留原有不确定性说明。
 * @param events - 本轮脱敏事件。
 */
function applicationNotice(events: DiagnosticEvent[]): string {
  return events.some(/** 检查实际采集的应用来源。
   * @param item - 当前事件。 */ item => item.source === 'application') ? '已采集应用选线与缓存决策。' :
    '当前构建未提供应用决策事件：缓存命中、未尝试原因和主动线路切换无法确定。';
}

/**
 * 将一个节点输出为 Markdown 表格行。
 * @param entry - 节点名和统计行。
 */
function nodeLine([node, row]: [string, NodeRow]): string {
  return `| ${node.replace(/[|<>\r\n]/g, '')} | ${row.probes} | ${row.upstream} | ${row.mocked} | ${row.cached} | ${row.sockets} |`;
}

/**
 * 输出最近事件的相对时间和白名单字段。
 * @param item - 当前事件。
 * @param startedAt - 收集起点。
 */
function eventLine(item: DiagnosticEvent, startedAt: number): string {
  const { observedAt, event, ...fields } = item;
  return `+${Math.max(0, observedAt - startedAt)}ms ${event} ${JSON.stringify(fields)}`.replace(/`/g, '');
}

/**
 * 生成与既有附件一致的节点汇总和最近三十五条事件。
 * @param title - 用例标题。
 * @param snapshot - 已按观测时间稳定排序的快照。
 */
export function diagnosticSummary(title: string, snapshot: { startedAt: number; dropped: number; events: DiagnosticEvent[] }): string {
  const { events, dropped, startedAt } = snapshot;
  const nodes: Nodes = new Map();
  for (const item of events) collectNode(nodes, item);
  const lines = [`### ${diagnosticText(title).replace(/[\r\n|<>]/g, ' ')}`, '',
    `事件 ${events.length} 条；截断 ${dropped} 条。浏览器发出请求不等于上游已收到。`, applicationNotice(events), '',
    '| 节点 | 浏览器健康探测 | 上游健康响应 | 模拟健康响应 | 缓存命中 | WebSocket 尝试 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |', ...Array.from(nodes, nodeLine),
    '', '最近事件（完整记录见 connection-diagnostics.json）：', '', '```text',
    ...events.slice(-35).map(/** 格式化相对时间事件。
     * @param item - 最近事件。 */ item => eventLine(item, startedAt)), '```', ''];
  return lines.join('\n');
}
