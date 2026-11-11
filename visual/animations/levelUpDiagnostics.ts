import type { Page, TestInfo } from '@playwright/test';

/**
 * 记录升级退场附近定时器的注册和触发时间，不推进时钟或读取业务正文。
 * @param page - 本轮独占的牌桌页面。
 */
export async function installLevelUpDiagnostics(page: Page): Promise<void> {
  try {
    await page.evaluate(/** 安装只记录固定延时范围的浏览器计时器。 */ () => {
      const state = window as typeof window & { levelUpTiming?: {
        original: typeof window.setTimeout; events: object[];
      } };
      const original = window.setTimeout as (handler: TimerHandler, timeout?: number, ...args: any[]) => number;
      const events: object[] = [];
      state.levelUpTiming = { original: window.setTimeout, events };
      const tracing = {
        /** 保留原延时、参数和返回的取消句柄。
         * @param handler - 原回调。
         * @param timeout - 原延时。
         * @param args - 原回调参数。 */
        schedule(handler: TimerHandler, timeout?: number, ...args: any[]) {
        if (typeof handler !== 'function' || !timeout || timeout < 4500 || timeout > 5500) {
          return original.call(window, handler, timeout, ...args);
        }
        const scheduled = Date.now();
        try { if (events.length < 40) events.push({ event: 'scheduled', timeout, time: scheduled }); } catch { /* 只读诊断。 */ }
        const callback = {
          /** 在原回调执行前记录虚拟时间，保持原异常传播。
           * @param values - 浏览器传入的原参数。 */
          fire(...values: any[]) {
          try { if (events.length < 40) events.push({ event: 'fired', timeout, scheduled, time: Date.now() }); } catch { /* 保留回调。 */ }
          return handler.apply(window, values);
          }
        };
        return original.call(window, callback.fire, timeout, ...args);
        }
      };
      window.setTimeout = tracing.schedule as typeof window.setTimeout;
    });
  } catch { /* 诊断不可用仍执行原采样。 */ }
}

/**
 * 恢复定时器入口，并在原采样完成后保存有限计时信息。
 * @param page - 本轮页面。
 * @param info - 原测试报告。
 */
export async function saveLevelUpDiagnostics(page: Page, info: TestInfo): Promise<void> {
  try {
    const body = await page.evaluate(/** 读取有界事件并恢复原入口。 */ () => {
      const state = window as typeof window & { levelUpTiming?: {
        original: typeof window.setTimeout; events: object[];
      } };
      const timing = state.levelUpTiming;
      if (!timing) return [];
      window.setTimeout = timing.original;
      delete state.levelUpTiming;
      return timing.events;
    });
    await info.attach('zhajinhua-level-up-timers', { body: JSON.stringify(body), contentType: 'application/json' });
  } catch { /* 附件失败不替换原始采样或断言异常。 */ }
}
