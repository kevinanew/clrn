import type { AndroidDevice } from 'playwright';
import presentation from '../visual/fixtures/game-presentation.json';
import type { TestInfo } from '@playwright/test';
import { compareScreenshot } from './device';
import { gameNodes, gameReady } from './game-controls';
import { expect } from '@playwright/test';
import type { ScreenshotMask } from './screenshot';
import { foregroundPanels, visibleMasks } from './game-masks';
import { captureChallengeAnimation } from './game-animation';

/**
 * 保留真实牌桌布局，仅遮罩明确的房号、网络延迟和循环座位指示箭头。
 * @param device - 专用模拟器连接。
 * @param name - 共享场景与状态生成的截图名。
 * @param testInfo - 当前测试报告。
 * @param transientMarker - 仅用于会自动消失的提示，截图前后都必须实际存在。
 * @param expectedAlertMarker - 错误分支已断言内容后，允许截图的特定业务弹窗按钮。
 */
export async function captureGame(device: AndroidDevice, name: string, testInfo: TestInfo, transientMarker?: string,
  expectedAlertMarker?: string): Promise<void> {
  if (expectedAlertMarker) await gameReady(device, expectedAlertMarker);
  let nodes = await gameNodes(device);
  if ((!transientMarker || transientMarker === 'level-up-title') && foregroundPanels(nodes).length) {
    let previous = '';
    await expect(async () => {
      nodes = await gameNodes(device);
      const current = JSON.stringify(foregroundPanels(nodes).map(node => node.bounds));
      const before = previous;
      previous = current;
      expect(current, '前景面板边界须完成转场后再裁剪背景遮罩').toBe(before);
    }).toPass({ timeout: 30_000, intervals: [300] });
  }
  if (expectedAlertMarker) expect(nodes.some(node => node.res === expectedAlertMarker), '目标业务提示必须可见').toBe(true);
  expect(nodes.some(node => node.res === 'android:id/message' || (!expectedAlertMarker && node.res === 'common-alert-message')),
    '截图前不能存在意外错误提示').toBe(false);
  const masks: ScreenshotMask[] = [];
  const panels = foregroundPanels(nodes);
  await testInfo.attach(`${name}-native-tree`, { body: JSON.stringify(nodes[0]), contentType: 'application/json' });
  for (const node of nodes) {
    /**
     * 只排除仍可见的动态内容，保留覆盖其上的真实弹窗。
     * @param mask - 当前动态控件的范围。
     */
    const add = (mask: ScreenshotMask) => masks.push(...visibleMasks(mask, node, panels));
    if (['texas-holdem-room-id-text', 'zhajinhua-room-id-text'].includes(node.res || '')) {
      expect(node.text, '房号展示应与 Web 共用夹具一致').toBe(presentation.roomNumber);
      continue;
    }
    if (/^seat-guide-\d+$/.test(node.res || '')) {
      // Android 将越出父节点的箭头边界裁短；按共用 24×20 图案及 11dp 动画行程还原范围。
      const scale = node.bounds.width / 24;
      const height = 20 * scale;
      add({ x: node.bounds.x - 1, y: node.bounds.y + node.bounds.height - height - 1,
        width: node.bounds.width + 2, height: height + 22 + 2, reason: `${node.res} 完整箭头动画范围` });
      continue;
    }
    if (/^(texas-holdem|zhajinhua)-active-countdown$/.test(node.res || '') || node.res === 'seat-progress-pie') {
      // API 35 控件边界向下取整；实测相邻帧在右侧两像素仍有倒计时填充变化。
      add({ x: node.bounds.x - 2, y: node.bounds.y - 2,
        width: node.bounds.width + 4, height: node.bounds.height + 4,
        reason: `${node.res} 含两像素绘制边缘` });
      continue;
    }
    if (['leader-board-room-id', 'game-network-proxy-code'].includes(node.res || '')
      || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(node.text || '')
      || (node.res === 'countdown_timer_text' && /^\d+s$/.test(node.text || ''))
      || node.res === 'view-community-cards-countdown'
      || node.res === 'player-profile-id'
      || (!node.res && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(node.text || ''))) {
      // 玩家 ID 是透明语义标记；不能因它覆盖头像而把整个头像排除。
      add({ ...node.bounds, reason: node.res || (node.text?.includes(':') ? '保座或加时冷却倒计时' : '本轮真实房间 UUID') });
    }
    if (node.res === 'ping-screen-text') {
      add({ ...node.bounds, x: node.bounds.x + node.bounds.width / 2 - 40, width: 80, reason: '网络延迟数值' });
    }
    if (node.res === 'ping-screen-icon') add({ ...node.bounds, reason: '网络延迟状态图标' });
  }
  if (name.endsWith('-zhajinhua-game-challenge-select')) {
    await captureChallengeAnimation(device, name, testInfo, masks);
    return;
  }
  /** 不允许把提示消失后的稳定页面当成提示截图。 */
  const assertTransient = async () => {
    expect((await gameNodes(device)).some(node => node.res === transientMarker && node.text),
      `${transientMarker} 必须在截图前后可见`).toBe(true);
  };
  await compareScreenshot(device, name, testInfo, masks, transientMarker ? assertTransient : undefined);
}
