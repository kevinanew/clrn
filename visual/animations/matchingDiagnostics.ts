/** 只读匹配取消取证：沿用 slotSpin 的按连接、编号关联方式，不推进时钟。 */
import type { Page } from '@playwright/test';

type Action = 'join' | 'quit' | 'keep_waiting';
type Entry = { event: string; connection: number; observedAt: number; commandId?: number;
  action?: Action; outcome?: string };

/** 在导航前观察匹配 RPC；只保留固定动作、整数编号和结果分类。
 * @param page - 要观察的页面。 */
export function observeMatchingReplies(page: Page) {
  const events: Entry[] = [];
  let connections = 0, dropped = 0;
  /** 有界保存元数据，不记录消息正文或错误文本。
   * @param entry - 要保存的事件。 */
  const record = (entry: Omit<Entry, 'observedAt'>) => {
    if (events.length === 200) { events.shift(); dropped++; }
    events.push({ ...entry, observedAt: Date.now() });
  };
  page.on('websocket', /** 为各连接建立独立的有界关联表。
   * @param socket - 新建的连接。 */ socket => {
    const connection = ++connections;
    const pending = new Map<number, Action>();
    record({ event: 'socket-open', connection });
    socket.on('framesent', /** 只观察匹配命令的固定元数据。
     * @param root0 - 发送帧。 */ ({ payload }) => {
      for (const frame of frames(payload)) {
        const action = matchingAction(frame);
        if (!action || !Number.isSafeInteger(frame.id)) continue;
        if (pending.size === 100) pending.delete(pending.keys().next().value!);
        pending.set(frame.id, action);
        record({ event: 'command', connection, commandId: frame.id, action });
      }
    });
    socket.on('framereceived', /** 关联本连接的待确认命令。
     * @param root0 - 接收帧。 */ ({ payload }) => {
      for (const frame of frames(payload)) {
        const action = pending.get(frame.id);
        if (!action) continue;
        pending.delete(frame.id);
        const outcome = frame.error ? 'protocol-error' : businessOutcome(frame.result?.data);
        record({ event: 'reply', connection, commandId: frame.id, action, outcome });
      }
    });
    socket.on('close', /** 保留断线发生顺序。 */ () => record({ event: 'socket-close', connection }));
    socket.on('socketerror', /** 丢弃可能含地址的错误正文。 */ () => record({ event: 'socket-error', connection }));
  });
  return { snapshot: /** 返回只读事件副本。 */ () => ({ events: [...events], dropped }) };
}

/** 损坏帧与无关帧不能使诊断监听器抛错。
 * @param payload - 帧正文。 */
function frames(payload: string | Buffer): any[] {
  return String(payload).split('\n').slice(0, 100).flatMap(/** 逐行解析，忽略损坏消息。
   * @param line - 单行消息。 */ line => {
    try {
      const frame = JSON.parse(line);
      return frame && typeof frame === 'object' ? [frame] : [];
    } catch { return []; }
  });
}

/** 只识别固定路径，不保存查询、认证参数或任意动作。
 * @param frame - 待识别的帧。 */
function matchingAction(frame: any): Action | undefined {
  if (frame.method !== 9) return;
  const path = frame.params?.data?.path;
  if (typeof path !== 'string') return;
  return /^\/v1\/hall_matching\/(join|quit|keep_waiting)$/.exec(path)?.[1] as Action | undefined;
}

/** 业务正文只投影为三种固定结果。
 * @param data - 业务结果。 */
function businessOutcome(data: any): string {
  if (data?.ok === true) return 'success';
  return data?.ok === false ? 'business-error' : 'unknown';
}
