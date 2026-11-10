/** 只读观察独立 Node 删房请求；不记录 URL、请求头、房间 ID 或底层错误正文。 */
import { channel } from 'node:diagnostics_channel';

/**
 * 失败时区分请求尚未发出和等待响应；诊断异常不能覆盖请求异常。
 * @param url - 当前删除请求地址，仅用于关联，不输出。
 * @param request - 保留原有配置和断言的请求操作。
 */
export async function diagnoseRoomDelete<T>(url: string, request: () => Promise<T>): Promise<T> {
  let phase = 'not-observed';
  let target: unknown;
  const listeners: Array<{ name: string; listener: (message: any) => void }> = [];
  /**
   * 为当前请求添加只读观察者，忽略采集自身的异常。
   * @param name - Undici 诊断频道。
   * @param next - 当前频道对应的固定阶段。
   */
  const observe = (name: string, next: string) => {
    /**
     * 只关联本次删除请求，禁止输出原始消息。
     * @param message - Undici 内部请求事件。
     */
    const listener = (message: any) => {
      try {
        const entry = message.request;
        if (next === 'created' && entry.method === 'DELETE'
          && String(entry.origin) + entry.path === url) target = entry;
        if (target && entry === target) phase = next;
      } catch { /* 只读诊断不得影响请求。 */ }
    };
    listeners.push({ name, listener });
    channel(name).subscribe(listener);
  };
  try {
    observe('undici:request:create', 'created');
    observe('undici:request:bodySent', 'sent-awaiting-response');
    observe('undici:request:headers', 'response-received');
  } catch { /* 不支持诊断时仍执行原始请求。 */ }
  const started = Date.now();
  try {
    return await request();
  } catch (error) {
    try {
      console.error(`ROOM DELETE DIAGNOSTIC > phase=${phase} elapsedMs=${Date.now() - started}`);
    } catch { /* 日志失败不能覆盖原始异常。 */ }
    throw error;
  } finally {
    for (const { name, listener } of listeners) {
      try { channel(name).unsubscribe(listener); } catch { /* 不改变请求结果。 */ }
    }
  }
}
