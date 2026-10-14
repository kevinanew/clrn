import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { compareScreenshot } from './device';
import { gameNodes } from './game-controls';
import { expect } from '@playwright/test';
import type { ScreenshotMask } from './screenshot';

/**
 * 保留真实牌桌布局，仅遮罩明确的房号、网络延迟和循环座位指示箭头。
 * @param device - 专用模拟器连接。
 * @param name - 共享场景与状态生成的截图名。
 * @param testInfo - 当前测试报告。
 */
export async function captureGame(device: AndroidDevice, name: string, testInfo: TestInfo): Promise<void> {
  const nodes = await gameNodes(device);
  expect(nodes.some(node => node.res === 'android:id/message' || node.res === 'common-alert-message'),
    '截图前不能存在意外错误提示').toBe(false);
  const masks: ScreenshotMask[] = [];
  for (const node of nodes) {
    if (/^seat-guide-\d+$/.test(node.res || '')) {
      // Android 将越出父节点的箭头边界裁短；按共用 24×20 图案及 11dp 动画行程还原范围。
      const scale = node.bounds.width / 24;
      const height = 20 * scale;
      masks.push({ x: node.bounds.x - 1, y: node.bounds.y + node.bounds.height - height - 1,
        width: node.bounds.width + 2, height: height + 22 + 2, reason: `${node.res} 完整箭头动画范围` });
      continue;
    }
    if (['texas-holdem-room-id-text', 'zhajinhua-room-id-text'].includes(node.res || '')
      || /^(texas-holdem|zhajinhua)-active-countdown$/.test(node.res || '')
      || (['countdown-text', 'zhajinhua-countdown'].includes(node.res || '') && /^\d+:\d+/.test(node.text || ''))
      || node.res === 'player-profile-id'
      || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(node.text || '')) {
      masks.push({ ...node.bounds, reason: node.res || '本轮真实房间 UUID' });
    }
    if (node.res === 'ping-screen-text') {
      masks.push({ ...node.bounds, x: node.bounds.x + node.bounds.width / 2 - 40, width: 80, reason: '网络延迟数值' });
    }
    if (node.res === 'ping-screen-icon') masks.push({ ...node.bounds, reason: '网络延迟状态图标' });
  }
  await compareScreenshot(device, name, testInfo, masks);
}
