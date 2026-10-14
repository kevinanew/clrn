import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { gameSession } from './game-room';
import { gameNodes } from './game-controls';

/**
 * 复用 Web 回放控制接口，且只允许本轮真实建房响应中登记的 UUID。
 * @param proxy - 本轮独占代理。
 * @param game - 共用的玩法代理名。
 * @param roomId - 本轮创建的房间。
 * @param data - Web 共用的网络事件夹具。
 */
export async function replay(proxy: Mitmproxy, game: 'texas' | 'zhajinhua', roomId: string, data: unknown): Promise<void> {
  expect((await gameSession(proxy)).room?.roomId, '回放只能发送到本轮新建的私人房').toBe(roomId);
  await expect(async () => {
    await proxy.command(`${game}/replay`, { roomId, data });
  }).toPass({ timeout: 30_000, intervals: [500] });
}

/**
 * 断言可见牌面容器关联的牌名。辅助文字可能被 Android 裁到父容器外，
 * 只从实际可见的牌面容器读取它，不能把屏外历史牌面计入当前状态。
 * @param device - 专用模拟器连接。
 * @param container - 当前牌面的可见容器 ID。
 * @param marker - 容器内的语义牌名 ID。
 * @param expected - 顺序无关的预期文字。
 */
export async function gameCardNames(device: AndroidDevice, container: string, marker: string, expected: string[]): Promise<void> {
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === container)
    .map(node => node.children?.find(child => child.res === marker)?.text || '').sort(),
  { timeout: 30_000, intervals: [250] }).toEqual([...expected].sort());
}
