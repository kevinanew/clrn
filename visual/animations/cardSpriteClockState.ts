import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
type Timer = {
  id: number;
  type: string;
  delay: number;
  remaining: number;
  age: number;
  callback: string;
};
type Snapshot = {
  status: 'observed';
  running: boolean;
  virtualTime: number;
  ticks: number;
  timers: Timer[];
} | {
  status: 'not-installed' | 'unsupported' | 'unavailable';
};
/**
 * 只读保存 Playwright 1.61.1 的待执行计时器，区分冻结与恢复后的现场。
 * 内部结构不支持时明确记录，绝不安装、推进或修补时钟。
 * @param page - 仍存活的原始牌桌页面。
 */
export async function cardSpriteClockState(page: Page): Promise<Snapshot> {
  const snapshot: Snapshot = await page.evaluate(/** 校验页面时钟控制器并采集虚拟时间与待执行计时器的安全快照。 */ () => {
    const checks = {
      /**
       * 核对控制器结构后只读采集快照。
       * @param controller - Playwright 私有时钟结构。
       * @returns 有限状态及定时器队列。
       */
      readController(controller: Controller) {
        if (!controller._now || !(controller._timers instanceof Map))
          return { status: 'unsupported' as const };
        return checks.readTimers(controller._now, controller._timers, Boolean(controller._realTime));
      },
      /**
       * 拒绝非有限时间与不受支持的定时器结构。
       * @param now - 当前时钟读数。
       * @param timers - Playwright 计时器。
       * @param running - 是否正在使用真实时间。
       * @returns 只读快照。
       */
      readTimers(now: {
        time: number;
        ticks: number;
      }, timers: Map<number, ClockTimer>, running: boolean) {
        const { time, ticks } = now;
        if (!Number.isFinite(time) || !Number.isFinite(ticks))
          return { status: 'unsupported' as const };
        return checks.validSnapshot(now, timers, running);
      },
      /**
       * 校验队列后保留回调源码供宿主立即摘要，源码不进入附件。
       * @param now - 有效时间。
       * @param timers - 计时器队列。
       * @param running - 是否正在运行。
       * @returns 受支持快照或明确的 unsupported 状态。
       */
      validSnapshot(now: {
        time: number;
        ticks: number;
      }, timers: Map<number, ClockTimer>, running: boolean) {
        const { time, ticks } = now;
        const valid = Array.from(timers.values()).every(checks.validTimer);
        if (!valid)
          return { status: 'unsupported' as const };
        return { status: 'observed' as const, running, virtualTime: time, ticks,
          timers: Array.from(timers, /** 将计时器转换为包含剩余时间、存活时长与回调来源的快照。
        * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ([id, timer]) => ({ id, type: timer.type, delay: timer.delay,
            remaining: timer.callAt - ticks, age: ticks - timer.createdAt,
            callback: typeof timer.func === 'function' ? Function.prototype.toString.call(timer.func) : timer.func as string,
          })) };
      },
      /**
       * 核对类型、数值与回调字段，不执行任意对象转换。
       * @param timer - 原始计时器。
       * @returns 是否符合固定版本结构。
       */
      validTimer(timer: ClockTimer): boolean {
        return ['Timeout', 'Interval', 'AnimationFrame', 'IdleCallback'].includes(timer.type)
          && checks.validTimerTimes(timer) && ['function', 'string'].includes(typeof timer.func);
      },
      /**
       * 三个计时字段都必须为有限值。
       * @param timer - 原始计时器。
       * @returns 时间字段是否有效。
       */
      validTimerTimes(timer: ClockTimer): boolean {
        return [timer.delay, timer.callAt, timer.createdAt].every(Number.isFinite);
      }
    };
    type ClockTimer = {
      type: string;
      delay: number;
      callAt: number;
      createdAt: number;
      func: unknown;
    };
    type Controller = {
      _now?: {
        time: number;
        ticks: number;
      };
      _timers?: Map<number, ClockTimer>;
      _realTime?: unknown;
    };
    const state = window as typeof window & {
      __pwClock?: {
        controller?: Controller;
      };
    };
    if (!state.__pwClock)
      return { status: 'not-installed' as const };
    const controller = state.__pwClock.controller;
    if (!controller)
      return { status: 'unsupported' as const };
    return checks.readController(controller);
  }).catch(/** 时钟读取异常时返回不可用状态，保留原测试结果。 */ () => ({ status: 'unavailable' as const }));
  if (snapshot.status !== 'observed')
    return snapshot;
  // 回调代码仅在内存中求摘要，不保存源码、闭包、堆栈、参数或连接信息。
  return { ...snapshot, timers: snapshot.timers.map(/** 将当前条目映射为`{ ...timer, callback: 'callback-' + createHash('sha256').update(timer.callback).digest('hex').slice(0, 16), }`。
    * @param timer - 当前操作使用的 timer。 */ timer => ({ ...timer,
      callback: 'callback-' + createHash('sha256').update(timer.callback).digest('hex').slice(0, 16),
    })) };
}
