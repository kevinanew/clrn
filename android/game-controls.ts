import { expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb } from './device';
import type { ScreenshotBounds } from './screenshot';
import { setTimeout } from 'node:timers/promises';

export type NativeNode = { res?: string; text?: string; enabled?: boolean; checked?: boolean;
  bounds: ScreenshotBounds; children?: NativeNode[] };

/**
 * 直接由 UiAutomation 截取真实屏幕，避免每帧启动 screencap 进程错过短时提示。
 * @param device - 使用固定补丁驱动的模拟器连接。
 */
export async function gameScreenshot(device: AndroidDevice): Promise<Buffer> {
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<string> } } })._connection.toImpl(device);
  const timeout = new AbortController();
  try {
    const encoded = await Promise.race([
      implementation._send('screen'),
      setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生截图超时。'); }),
    ]);
    const png = Buffer.from(encoded, 'base64');
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('原生截图没有返回 PNG。');
    return png;
  } finally { timeout.abort(); }
}

/**
 * 快速读取一个真实提示节点，用于截图前后的短时可见性断言。
 * @param device - 使用固定补丁驱动的模拟器连接。
 * @param resource - 提示控件标记。
 */
export async function gameMarker(device: AndroidDevice, resource: string): Promise<NativeNode | null> {
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string, parameters: { resource: string }): Promise<NativeNode | null> } } })._connection.toImpl(device);
  const timeout = new AbortController();
  try {
    const node = await Promise.race([
      implementation._send('marker', { resource }),
      setTimeout(5000, undefined, { signal: timeout.signal }).then(() => { throw new Error('原生提示节点查询超时。'); }),
    ]);
    return node && flattenNodes(node).length ? node : null;
  } finally { timeout.abort(); }
}

/**
 * 一次读取原生无障碍树，避免重复 ID 及动画期间逐字段查询导致长时间阻塞。
 * 固定的 Playwright 1.61.1 驱动已提供 tree 命令；协议变化时明确失败。
 * @param device - 本机进程内创建的原生驱动连接。
 */
export async function gameNodes(device: AndroidDevice): Promise<NativeNode[]> {
  const internal = device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _send(method: string): Promise<NativeNode> } } };
  for (let attempt = 0; ; attempt++) {
    const timeout = new AbortController();
    try {
      // 内部协议不受 device.setDefaultTimeout 约束；断连时不能一直等到整例超时。
      const root = await Promise.race([
        internal._connection.toImpl(device)._send('tree'),
        setTimeout(30_000, undefined, { signal: timeout.signal }).then(() => {
          throw new Error('原生控件树查询超过 30 秒，驱动未响应。');
        }),
      ]);
      if (!root?.bounds || !Array.isArray(root.children)) throw new Error('原生驱动没有返回完整控件树。');
      return flattenNodes(root);
    } catch (error) {
      // 转场会在驱动遍历过程中移除子节点；重读整棵树，不返回残缺或伪造的空结果。
      if (attempt >= 4 || !/NullPointerException|StaleObjectException/.test(String(error))) throw error;
      await setTimeout(250);
    } finally { timeout.abort(); }
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
 * 从已确认可见的容器读取语义文字，保留 Android 裁到容器外的透明辅助节点。
 * @param root - 当前可见玩家或牌面容器，不能传入整棵窗口树。
 * @param marker - 明确指定的辅助文字标记。
 */
export function gameSemanticText(root: NativeNode | undefined, marker: string): string | undefined {
  if (!root) return undefined;
  if (root.res === marker) return root.text;
  for (const child of root.children || []) {
    const value = gameSemanticText(child, marker);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * 读取可见容器边界内的控件，兼容 Fabric 把内容压平为容器兄弟节点的情况。
 * @param nodes - 本次完整查询得到的可见控件。
 * @param marker - 要限定的真实容器标记。
 */
export function gameNodesWithin(nodes: NativeNode[], marker: string): NativeNode[] {
  const container = nodes.find(node => node.res === marker)?.bounds;
  if (!container) return [];
  return nodes.filter(node => node.bounds.x >= container.x && node.bounds.y >= container.y
    && node.bounds.x + node.bounds.width <= container.x + container.width
    && node.bounds.y + node.bounds.height <= container.y + container.height);
}

/**
 * 读取真实容器边界内的全部可见文字。
 * @param nodes - 本次完整查询得到的可见控件。
 * @param marker - 要限定的真实容器标记。
 */
export function gameTextWithin(nodes: NativeNode[], marker: string): string[] {
  return gameNodesWithin(nodes, marker).filter(node => node.text).map(node => node.text!);
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
 * @param nativeInput - 短时提示使用现有驱动点击，避免启动 shell 输入进程耗尽显示时间。
 */
export async function gameTap(device: AndroidDevice, res: string, nativeInput = false): Promise<void> {
  console.log(`ANDROID > 游戏点击 ${res}`);
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
  const point = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
  if (nativeInput) await device.input.tap(point);
  else adb('shell', 'input', 'tap', String(point.x), String(point.y));
}
