/** 每条用例独立收集有界的诊断时间线，并输出可直接阅读的节点摘要。 */
import { diagnosticFields, diagnosticText } from './diagnostic-privacy';

export type DiagnosticEvent = ReturnType<typeof diagnosticFields> & { event: string; observedAt: number };

/** 按真实收集时间记录事件；不使用被动画测试冻结的浏览器时钟。 */
export class DiagnosticRecorder {
  readonly startedAt = Date.now();
  readonly events: DiagnosticEvent[] = [];
  dropped = 0;

  /**
   * 写入脱敏事件，超过容量时保留最近现场并明确标记截断。
   * @param event - 事件类型。
   * @param fields - 白名单字段。
   */
  record(event: string, fields: unknown = {}): void {
    const safe = diagnosticFields(fields);
    const observedAt = typeof safe.observedAt === 'number' ? safe.observedAt : Date.now();
    this.events.push({ ...safe, event: diagnosticText(event), observedAt });
    if (this.events.length > 5000) { this.events.shift(); this.dropped++; }
  }

  /**
   * 合并代理历史后按时间截断，避免较早的代理事件挤掉较新的浏览器失败现场。
   * @param history - 代理返回的脱敏事件。
   * @param dropped - 代理自行截断的事件数。
   */
  merge(history: unknown[], dropped = 0): void {
    const imported = history.map(value => {
      const fields = diagnosticFields(value);
      return { ...fields, event: String(fields.event || 'proxy.event'),
        observedAt: typeof fields.observedAt === 'number' ? fields.observedAt : Date.now() };
    });
    const combined = [...this.events, ...imported].sort((left, right) => left.observedAt - right.observedAt);
    this.dropped += Math.max(0, combined.length - 5000) + dropped;
    this.events.splice(0, this.events.length, ...combined.slice(-5000));
  }

  /**
   * 输出完整时间线；同一时间使用稳定排序。
   */
  snapshot(): { startedAt: number; dropped: number; events: DiagnosticEvent[] } {
    return { startedAt: this.startedAt, dropped: this.dropped,
      events: [...this.events].sort((left, right) => left.observedAt - right.observedAt) };
  }

  /**
   * 输出节点汇总和最近事件，缺失的应用决策不会被推测成缓存命中。
   * @param title - 用例和视口名称。
   */
  markdown(title: string): string {
    const { events } = this.snapshot();
    const nodes = new Map<string, { probes: number; upstream: number; mocked: number; cached: number; sockets: number }>();
    for (const item of events) {
      const names = [item.node, ...(Array.isArray(item.candidates) ? item.candidates : [])];
      for (const name of names) if (typeof name === 'string' && !nodes.has(name)) {
        nodes.set(name, { probes: 0, upstream: 0, mocked: 0, cached: 0, sockets: 0 });
      }
      const row = typeof item.node === 'string' ? nodes.get(item.node) : undefined;
      if (!row) continue;
      if (item.path === '/node/v1/status' && item.method === 'GET') {
        if (item.event === 'http.start') row.probes++;
        if (item.event === 'proxy.response' && item.source === 'upstream') row.upstream++;
        if (item.event === 'proxy.response' && item.source === 'fixture') row.mocked++;
      }
      if (item.event === 'probe.cache') row.cached++;
      if (item.event === 'websocket.start') row.sockets++;
    }
    const lines = [`### ${diagnosticText(title).replace(/[\r\n|<>]/g, ' ')}`, '',
      `事件 ${events.length} 条；截断 ${this.dropped} 条。浏览器发出请求不等于上游已收到。`,
      events.some(item => item.source === 'application') ? '已采集应用选线与缓存决策。' :
        '当前构建未提供应用决策事件：缓存命中、未尝试原因和主动线路切换无法确定。', '',
      '| 节点 | 浏览器健康探测 | 上游健康响应 | 模拟健康响应 | 缓存命中 | WebSocket 尝试 |',
      '| --- | ---: | ---: | ---: | ---: | ---: |'];
    for (const [node, row] of nodes) lines.push(`| ${node.replace(/[|<>\r\n]/g, '')} | ${row.probes} | ${row.upstream} | ${row.mocked} | ${row.cached} | ${row.sockets} |`);
    lines.push('', '最近事件（完整记录见 connection-diagnostics.json）：', '', '```text');
    for (const item of events.slice(-35)) {
      const { observedAt, event, ...fields } = item;
      lines.push(`+${Math.max(0, observedAt - this.startedAt)}ms ${event} ${JSON.stringify(fields)}`.replace(/`/g, ''));
    }
    lines.push('```', '');
    return lines.join('\n');
  }
}
