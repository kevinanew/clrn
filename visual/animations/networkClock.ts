import type { Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * 逐段推进虚拟时钟，让服务器心跳有机会在应用超时前到达。
 * 保留真实协议、应用超时和每个采样时刻；截图及布局耗时可抵扣等待。
 * @param page - 已安装 Playwright 时钟、即将进行牌桌动画采样的页面。
 */
export async function paceNetworkClock(page: Page): Promise<void> {
  const clock = page.clock;
  const runFor = clock.runFor.bind(clock);
  const fastForward = clock.fastForward.bind(clock);
  // 先停止自动走时；100ms 留给协议往返，远短于真实连接的心跳窗口。
  await clock.pauseAt(await page.evaluate(() => Date.now()) + 100);
  const virtualStart = await page.evaluate(() => Date.now());
  const realStart = performance.now();
  /**
   * 让每段虚拟时间获得对应的真实网络时间，避免一次快进跨过整个心跳窗口。
   * @param ticks - 毫秒或 Playwright 支持的冒号分隔时间。
   * @param advance - 原始时钟推进方法。
   */
  const advanceInSteps = async (ticks: number | string, advance: typeof runFor) => {
    let remaining = milliseconds(ticks);
    while (remaining > 0) {
      const step = Math.min(16, remaining);
      const target = await page.evaluate(() => Date.now()) + step;
      const wait = target - virtualStart - (performance.now() - realStart);
      if (wait > 0) await delay(wait);
      await advance(step);
      remaining -= step;
    }
    if (milliseconds(ticks) === 0) await advance(0);
  };
  clock.runFor = /**
   * 逐帧推进并保持网络时间。
   * @param ticks - 推进时长。
   */ ticks => advanceInSteps(ticks, runFor);
  clock.fastForward = /**
   * 准备阶段仍保留快进语义，但每段让出真实网络回调。
   * @param ticks - 推进时长。
   */ ticks => advanceInSteps(ticks, fastForward);
  clock.pauseAt = /**
   * 已暂停的时钟通过相同节奏到达绝对采样点。
   * @param time - 目标虚拟时刻。
   */ async time => {
    const target = typeof time === 'number' ? time : new Date(time).getTime();
    await advanceInSteps(target - await page.evaluate(() => Date.now()), runFor);
  };
}

/**
 * 转换 Playwright 支持的毫秒数或冒号分隔时间。
 * @param value - 毫秒或形如 01:30 的时间。
 */
function milliseconds(value: number | string): number {
  return typeof value === 'number' ? value
    : value.split(':').reduce((total, part) => total * 60 + Number(part), 0) * 1000;
}
