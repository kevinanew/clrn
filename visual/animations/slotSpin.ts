/** 将真实点击、连接恢复与旋转响应交接分开，固定动画的采样起点。 */
import { expect, type Page } from '@playwright/test';
import { press } from './appSession';
import { scenarioStatus, selectScenario } from '../../e2e/helpers/scenario-proxy';

/**
 * 只读取长连接上的旋转命令及匹配回复，不保存认证和业务正文。
 * @param page - 尚未导航的页面。
 */
export function observeSlotSpinReplies(page: Page) {
  let received = 0;
  page.on('websocket', socket => {
    const pending = new Set<number>();
    socket.on('framesent', ({ payload }) => {
      for (const frame of frames(payload)) {
        if (frame.method === 9 && /^\/v2\/slot_machine\/user\/[^/]+\/spin$/.test(frame.params?.data?.path)) {
          pending.add(frame.id);
        }
      }
    });
    socket.on('framereceived', ({ payload }) => {
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
  return String(payload).split('\n').flatMap(line => {
    try { const frame = JSON.parse(line); return frame && typeof frame === 'object' ? [frame] : []; }
    catch { return []; }
  });
}

/**
 * 响应暂存期间允许连接重试定时器推进；精确请求计数仍拒绝缺失或重复请求。
 * @param page - 虚拟时钟已暂停的页面。
 * @param status - 当前网络夹具的请求和暂存计数。
 * @param expected - 本轮应有的累计请求数。
 */
export async function waitForDeferredSlotRequest(page: Page,
  status: () => Promise<{ spins: number; held: number }>, expected: number): Promise<void> {
  await expect.poll(async () => {
    await page.clock.runFor(16);
    const { spins, held } = await status();
    return { spins, held };
  }, { timeout: 30_000, intervals: [50], message: '老虎机旋转请求必须唯一命中本轮夹具并暂存回复' })
    .toEqual({ spins: expected, held: expected });
  // 同一页面的后续采样也从完整的 16ms RAF 边界开始。
  const now = await page.evaluate(() => Date.now());
  await page.clock.runFor((16 - now % 16) % 16);
}

/**
 * 点击一次并等待真实 RPC；收到对应回复后才将时钟交给关键帧采样器。
 * @param page - 动画页面。
 * @param context - 当前账号独占的代理上下文。
 * @param replies - 导航前安装的只读长连接观察器。
 * @param phase - 本轮具名奖励或能量不足场景。
 * @param expected - 累计旋转请求及回复数。
 */
export async function spinSlot(page: Page, context: object, replies: ReturnType<typeof observeSlotSpinReplies>,
  phase: string, expected: number): Promise<void> {
  await selectScenario(context, 'slot', { phase: `hold-${phase}` });
  await press(page, 'spin-button');
  await waitForDeferredSlotRequest(page, () => scenarioStatus(context), expected);
  await selectScenario(context, 'slot', { phase });
  await expect.poll(async () => {
    await page.clock.runFor(0);
    return replies.received();
  }, { message: '浏览器必须收到本轮旋转的匹配回复' }).toBe(expected);
}
