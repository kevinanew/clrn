import type { Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * 让每次动画推进获得对应的真实网络时间，避免提前触发服务器心跳超时。
 * 保留原始 runFor/fastForward 的回调次数与采样相位，不替换真实心跳或应用超时。
 * @param page - 已安装 Playwright 时钟、即将进行牌桌动画采样的页面。
 */
export function paceNetworkClock(page: Page): void {
  const clock = page.clock;
  const runFor = clock.runFor.bind(clock);
  const fastForward = clock.fastForward.bind(clock);
  const pauseAt = clock.pauseAt.bind(clock);
  /**
   * 单次推进原样交给 Playwright，不能拆分 fastForward 而改变循环动画相位。
   * @param ticks - 原始推进时长。
   * @param advance - 原始时钟推进方法。
   */
  const advanceWithNetwork = async (ticks: number | string, advance: typeof runFor) => {
    await delay(milliseconds(ticks));
    await advance(ticks);
  };
  clock.runFor = /**
   * 逐帧推进前让真实网络回调得到执行机会。
   * @param ticks - 推进时长。
   */ ticks => advanceWithNetwork(ticks, runFor);
  clock.fastForward = /**
   * 快进只调用一次，保持原始定时回调语义。
   * @param ticks - 推进时长。
   */ ticks => advanceWithNetwork(ticks, fastForward);
  clock.pauseAt = /**
   * 先暂停再等待，防止真实运行中的时钟越过暂停点；不增加额外虚拟时间。
   * @param time - 目标虚拟时刻。
   */ async time => {
    const before = await page.evaluate(() => Date.now());
    const target = typeof time === 'number' ? time : new Date(time).getTime();
    await pauseAt(time);
    await delay(Math.max(0, target - before));
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
