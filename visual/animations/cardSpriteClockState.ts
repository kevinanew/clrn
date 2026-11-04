import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';

type Timer = { id: number; type: string; delay: number; remaining: number; age: number; callback: string };
type Snapshot = { status: 'observed'; running: boolean; virtualTime: number; ticks: number; timers: Timer[] }
  | { status: 'not-installed' | 'unsupported' | 'unavailable' };

/**
 * 只读保存 Playwright 1.61.1 的待执行计时器，区分冻结与恢复后的现场。
 * 内部结构不支持时明确记录，绝不安装、推进或修补时钟。
 * @param page - 仍存活的原始牌桌页面。
 */
export async function cardSpriteClockState(page: Page): Promise<Snapshot> {
  const snapshot: Snapshot = await page.evaluate(() => {
    const state = window as typeof window & { __pwClock?: { controller?: {
      _now?: { time: number; ticks: number }; _timers?: Map<number, {
        type: string; delay: number; callAt: number; createdAt: number; func: unknown;
      }>; _realTime?: unknown;
    } } };
    if (!state.__pwClock) return { status: 'not-installed' as const };
    const controller = state.__pwClock.controller;
    if (!controller?._now || !(controller._timers instanceof Map)) return { status: 'unsupported' as const };
    const { time, ticks } = controller._now;
    if (!Number.isFinite(time) || !Number.isFinite(ticks)) return { status: 'unsupported' as const };
    const valid = Array.from(controller._timers.values()).every(timer =>
      ['Timeout', 'Interval', 'AnimationFrame', 'IdleCallback'].includes(timer.type)
      && Number.isFinite(timer.delay) && Number.isFinite(timer.callAt) && Number.isFinite(timer.createdAt)
      && ['function', 'string'].includes(typeof timer.func));
    if (!valid) return { status: 'unsupported' as const };
    return { status: 'observed' as const, running: Boolean(controller._realTime), virtualTime: time, ticks,
      timers: Array.from(controller._timers, ([id, timer]) => ({ id, type: timer.type, delay: timer.delay,
        remaining: timer.callAt - ticks, age: ticks - timer.createdAt,
        callback: typeof timer.func === 'function' ? Function.prototype.toString.call(timer.func) : timer.func as string,
      })) };
  }).catch(() => ({ status: 'unavailable' as const }));
  if (snapshot.status !== 'observed') return snapshot;
  // 回调代码仅在内存中求摘要，不保存源码、闭包、堆栈、参数或连接信息。
  return { ...snapshot, timers: snapshot.timers.map(timer => ({ ...timer,
    callback: 'callback-' + createHash('sha256').update(timer.callback).digest('hex').slice(0, 16),
  })) };
}
