import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { compareScreenshot } from './device';
import { waitAbsent } from './native-state';
import type { ScreenshotMask } from './screenshot';

/**
 * 保留真实牌桌布局，仅遮罩明确的房号、网络延迟和循环座位指示箭头。
 * @param device - 专用模拟器连接。
 * @param name - 共享场景与状态生成的截图名。
 * @param testInfo - 当前测试报告。
 */
export async function captureGame(device: AndroidDevice, name: string, testInfo: TestInfo): Promise<void> {
  await waitAbsent(device, { res: 'android:id/message' });
  const masks: ScreenshotMask[] = [];
  for (const res of ['texas-holdem-room-id-text', 'zhajinhua-room-id-text', 'ping-screen-text',
    ...Array.from({ length: 10 }, (_, index) => `seat-guide-${index}`)]) {
    const node = await device.info({ res }).catch(() => undefined);
    if (node && node.bounds.width > 0 && node.bounds.height > 0) masks.push({ ...node.bounds, reason: res });
  }
  const identifier = await device.info({ text: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i }).catch(() => undefined);
  if (identifier) masks.push({ ...identifier.bounds, reason: '本轮真实房间 UUID' });
  await compareScreenshot(device, name, testInfo, masks);
}
