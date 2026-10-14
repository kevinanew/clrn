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
 * 断言同一原生控件的全部可见文字，用于重复 ID 的牌面和筹码列表。
 * @param device - 专用模拟器连接。
 * @param res - 共用的控件 ID。
 * @param expected - 顺序无关的预期文字。
 */
export async function gameTexts(device: AndroidDevice, res: string, expected: string[]): Promise<void> {
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === res)
    .map(node => node.text || '').sort(), { timeout: 30_000, intervals: [250] }).toEqual([...expected].sort());
}
