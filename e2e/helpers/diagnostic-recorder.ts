/** 每条用例独立收集有界的诊断时间线，并输出可直接阅读的节点摘要。 */
import { diagnosticSummary, type DiagnosticEvent } from './diagnostic-summary';
import { diagnosticFields } from './diagnostic-privacy';

export type { DiagnosticEvent } from './diagnostic-summary';

/** 按真实收集时间记录事件；不使用被动画测试冻结的浏览器时钟。 */
export class DiagnosticRecorder {
  readonly startedAt = Date.now();
  readonly events: DiagnosticEvent[] = [];
  dropped = 0;

  /**
   * 可选持久化出口收到每条脱敏事件，早于内存轮转，不改变既有快照语义。
   * @param onEvent - 持续落盘回调；原有用例默认只保留内存快照。
   */
  constructor(private readonly onEvent?: (event: DiagnosticEvent) => void) {}

  /**
   * 写入脱敏事件，超过容量时保留最近现场并明确标记截断。
   * @param event - 事件类型。
   * @param fields - 白名单字段。
   */
  record(event: string, fields: unknown = {}): void {
    const safe = diagnosticFields(fields);
    const observedAt = eventTime(safe.observedAt);
    const entry = { ...safe, event: String(diagnosticFields({ event }).event), observedAt };
    this.events.push(entry);
    this.onEvent?.(entry);
    this.trim();
  }

  /**
   * 合并代理历史后按时间截断，避免较早的代理事件挤掉较新的浏览器失败现场。
   * @param history - 代理返回的脱敏事件。
   * @param dropped - 代理自行截断的事件数。
   */
  merge(history: unknown[], dropped = 0): void {
    const imported = history.map(/** 将导入的代理历史整理成带事件名和观测时间的诊断条目。
 * @param value - 当前待转换或校验的值。 */ value => {
      const fields = diagnosticFields(value);
      return { ...fields, event: String(fields.event || 'proxy.event'),
        observedAt: typeof fields.observedAt === 'number' ? fields.observedAt : Date.now() };
    });
    const combined = [...this.events, ...imported].sort(/** 按观测时间合并排序浏览器与代理诊断事件。
 * @param left - 当前操作使用的 left。
 * @param right - 当前操作使用的 right。 */ (left, right) => left.observedAt - right.observedAt);
    this.dropped += Math.max(0, combined.length - 5000) + dropped;
    this.events.splice(0, this.events.length, ...combined.slice(-5000));
  }

  /**
   * 输出完整时间线；同一时间使用稳定排序。
   */
  snapshot(): { startedAt: number; dropped: number; events: DiagnosticEvent[] } {
    return { startedAt: this.startedAt, dropped: this.dropped,
      events: [...this.events].sort(/** 按观测时间排序已采集事件，生成稳定的诊断输出。
 * @param left - 当前操作使用的 left。
 * @param right - 当前操作使用的 right。 */ (left, right) => left.observedAt - right.observedAt) };
  }

  /**
   * 输出节点汇总和最近事件，缺失的应用决策不会被推测成缓存命中。
   * @param title - 用例和视口名称。
   */
  markdown(title: string): string {
    return diagnosticSummary(title, this.snapshot());
  }

  /** 保留最近五千条现场，并准确累计丢弃数。 */
  private trim(): void {
    if (this.events.length > 5000) { this.events.shift(); this.dropped++; }
  }
}

/**
 * 优先保留数值观测时间，否则读取真实宿主时钟。
 * @param value - 脱敏事件的观测时间。
 */
function eventTime(value: unknown): number {
  return typeof value === 'number' ? value : Date.now();
}
