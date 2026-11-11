/** 复用 0d4fef6 的只读旋转回复观察，区分代理处理与浏览器收到回复。 */
import type { Page } from '@playwright/test';

/**
 * 只读取长连接上的旋转命令及匹配回复，不保存认证和业务正文。
 * @param page - 尚未导航的页面。
 */
export function observeSlotSpinReplies(page: Page) {
  let received = 0;
  page.on('websocket', /** 为每条连接分别跟踪请求编号，避免重连编号冲突。
   * @param socket - 浏览器新建的连接。 */ socket => {
    const pending = new Set<number>();
    socket.on('framesent', /** 只登记旋转命令，不将代理端计数当成浏览器回复。
     * @param root0 - 发出的协议帧。 */ ({ payload }) => {
      for (const frame of frames(payload)) {
        if (isSpin(frame)) {
          pending.add(frame.id);
        }
      }
    });
    socket.on('framereceived', /** 仅累计同一连接已发出且尚未完成的旋转回复。
     * @param root0 - 浏览器收到的协议帧。 */ ({ payload }) => {
      for (const frame of frames(payload)) {
        if (pending.delete(frame.id)) received++;
      }
    });
  });
  return { /** 读取已在浏览器收到的对应回复数。 */ received: () => received };
}

/**
 * 解析单帧或批次；非 JSON 行不影响其他行的观察。
 * @param payload - 浏览器事件中的原始帧，仅在此处短暂读取。
 */
function frames(payload: string | Buffer): any[] {
  return String(payload).split('\n').flatMap(parseFrame);
}

/**
 * 只识别老虎机旋转 RPC，忽略能量读取及无关消息。
 * @param frame - 已解析的短暂协议对象。
 */
function isSpin(frame: any): boolean {
  if (frame.method !== 9) return false;
  return /^\/v2\/slot_machine\/user\/[^/]+\/spin$/.test(rpcPath(frame));
}

/**
 * 单行解析失败时忽略该行，不保存原始正文。
 * @param line - 短暂读取的协议行。
 */
function parseFrame(line: string): any[] {
  try { return objectFrame(JSON.parse(line)); }
  catch { return []; }
}

/**
 * 排除 null 和原始值，供编号与路径读取使用。
 * @param frame - JSON 解析值。
 */
function objectFrame(frame: any): any[] {
  return frame && typeof frame === 'object' ? [frame] : [];
}

/**
 * 从 RPC 包装中读取路径，缺失字段不会被视为旋转请求。
 * @param frame - 已解析的协议对象。
 */
function rpcPath(frame: any): string {
  return frame.params?.data?.path;
}
