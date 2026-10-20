import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from '@playwright/test';
import { paceNetworkClock } from './networkClock';

test('真实网络心跳不会被虚拟动画快进提前判为超时', async () => {
  let now = 0;
  let deadline = Infinity;
  let disconnected = false;
  /**
   * 模拟浏览器推进定时器时检查连接截止时间。
   * @param ticks - 本段虚拟时间。
   */
  const advance = async (ticks: number | string) => {
    now += Number(ticks);
    if (now >= deadline) disconnected = true;
  };
  const clock = {
    runFor: advance, fastForward: advance,
    /**
     * 首次暂停前时钟仍在真实运行。
     * @param time - 暂停时刻。
     */
    pauseAt: async (time: number) => { now = time; },
  };
  const page = {
    clock,
    /** 返回浏览器的虚拟时间。 */
    evaluate: async () => now,
  } as unknown as Page;
  await paceNetworkClock(page);
  deadline = now + 100;
  // 服务器每 20ms 发送心跳；不能因浏览器一次快进 240ms 而产生假断线。
  const heartbeat = setInterval(() => { deadline = now + 100; }, 20);
  try {
    await page.clock.fastForward(240);
    await page.clock.runFor('00:00.160');
    // 截图期间服务端持续发心跳，但虚拟时间暂停；这段等待不能变成快进额度。
    await delay(200);
    await page.clock.fastForward(240);
    await page.clock.pauseAt(new Date(now + 80));
    await page.clock.runFor(0);
    assert.equal(disconnected, false);
  } finally { clearInterval(heartbeat); }
  await page.clock.runFor(120);
  assert.equal(disconnected, true, '真实停止的心跳仍须触发连接超时');
});
