import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb } from './device';
import type { ScreenshotBounds } from './screenshot';
import { setTimeout } from 'node:timers/promises';

export type NativeNode = { res?: string; text?: string; enabled?: boolean; checked?: boolean;
  bounds: ScreenshotBounds; children?: NativeNode[] };

/**
 * 一次读取原生无障碍树，避免重复 ID 及动画期间逐字段查询导致长时间阻塞。
 * 固定的 Playwright 1.61.1 驱动已提供 tree 命令；协议变化时明确失败。
 * @param device - 本机进程内创建的原生驱动连接。
 */
export async function gameNodes(device: AndroidDevice): Promise<NativeNode[]> {
  const internal = device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeNode> } } };
  for (let attempt = 0; ; attempt++) {
    try {
      const root = await internal._connection.toImpl(device)._send('tree');
      if (!root?.bounds || !Array.isArray(root.children)) throw new Error('原生驱动没有返回完整控件树。');
      return flattenNodes(root);
    } catch (error) {
      // 转场会在驱动遍历过程中移除子节点；重读整棵树，不返回残缺或伪造的空结果。
      if (attempt >= 4 || !/NullPointerException|StaleObjectException/.test(String(error))) throw error;
      await setTimeout(250);
    }
  }
}

/**
 * 只返回有实际可见面积的节点，排除保留在屏幕外的历史弹层。
 * @param root - 原生无障碍树。
 */
export function flattenNodes(root: NativeNode): NativeNode[] {
  return [root, ...(root.children || []).flatMap(flattenNodes)]
    .filter(node => node.bounds.width > 0 && node.bounds.height > 0
      && node.bounds.x < 720 && node.bounds.y < 1280
      && node.bounds.x + node.bounds.width > 0 && node.bounds.y + node.bounds.height > 0);
}

/**
 * 等待实际可见的游戏控件；空查询不会吞掉驱动错误。
 * @param device - 专用模拟器连接。
 * @param res - 与 Web 共用的 testID。
 * @param text - 可选的就绪文字。
 */
export async function gameReady(device: AndroidDevice, res: string, text?: string): Promise<NativeNode> {
  let found: NativeNode | undefined;
  await expect(async () => {
    found = (await gameNodes(device)).find(node => node.res === res && (text === undefined || node.text === text));
    expect(found, `${res} 应可见`).toBeDefined();
  }).toPass({ timeout: 45_000, intervals: [250] });
  return found!;
}

/**
 * 等待游戏弹层完全移出屏幕。
 * @param device - 专用模拟器连接。
 * @param res - 弹层标记。
 */
export async function gameGone(device: AndroidDevice, res: string): Promise<void> {
  await expect.poll(async () => (await gameNodes(device)).some(node => node.res === res),
    { timeout: 45_000, intervals: [250] }).toBe(false);
}

/**
 * 根据两次一致的真实布局点击控件，使用 adb 输入避免驱动等待循环动画空闲。
 * @param device - 专用模拟器连接。
 * @param res - 与 Web 共用的 testID。
 */
export async function gameTap(device: AndroidDevice, res: string): Promise<void> {
  let previous: ScreenshotBounds | undefined;
  let node: NativeNode;
  await expect(async () => {
    node = await gameReady(device, res);
    const before = previous;
    previous = node.bounds;
    expect(node.enabled).not.toBe(false);
    expect(previous).toEqual(before);
  }).toPass({ timeout: 45_000, intervals: [200] });
  const { x, y, width, height } = node!.bounds;
  adb('shell', 'input', 'tap', String(Math.round(x + width / 2)), String(Math.round(y + height / 2)));
}
