import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from '@playwright/test';
import { paceNetworkClock } from './networkClock';

test('真实网络心跳不会被虚拟动画快进提前判为超时', async () => {
  let now = 0;
  let deadline = Infinity;
  let disconnected = false;
  const advances: (number | string)[] = [];
  /**
   * 模拟浏览器推进定时器时检查连接截止时间。
   * @param ticks - 本段虚拟时间。
   */
  const advance = async (ticks: number | string) => {
    advances.push(ticks);
    now += typeof ticks === "number" ? ticks : 40;
    if (now >= deadline) disconnected = true;
  };
  const clock = {
    runFor: advance, fastForward: advance,
    /**
     * 首次暂停前时钟仍在真实运行。
     * @param time - 暂停时刻。
     */
    pauseAt: async (time: number | string | Date) => { now = typeof time === "number" ? time : new Date(time).getTime(); },
  };
  const page = {
    clock,
    /** 返回浏览器的虚拟时间。 */
    evaluate: async () => now,
  } as unknown as Page;
  paceNetworkClock(page);
  deadline = now + 100;
  // 服务器每 20ms 发送心跳；不能因浏览器连续快进 而产生假断线。
  const heartbeat = setInterval(() => { deadline = now + 100; }, 20);
  try {
    for (let i = 0; i < 6; i++) await page.clock.fastForward(40);
    await page.clock.runFor('00:00.040');
    // 截图期间服务端持续发心跳，但虚拟时间暂停；这段等待不能变成快进额度。
    await delay(200);
    for (let i = 0; i < 6; i++) await page.clock.fastForward(40);
    await page.clock.pauseAt(new Date(now + 40));
    await page.clock.runFor(0);
    assert.equal(disconnected, false);
    assert.equal(advances.filter(ticks => ticks === 40).length, 12, "每次 fastForward 原样执行一次，不拆分定时回调");
  } finally { clearInterval(heartbeat); }
  await page.clock.runFor(120);
  assert.equal(disconnected, true, '真实停止的心跳仍须触发连接超时');
});
