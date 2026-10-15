import { expect } from '@playwright/test';
import type { AndroidDevice, AndroidSelector } from 'playwright';
import { adb } from './device';

/**
 * 通过真实滑动抵达列表末尾，连续两次滑动都不再移动页脚后才截图。
 * @param device - 专用模拟器连接。
 * @param list - 纵向滚动容器。
 * @param footer - 内容末尾的真实控件。
 */
export async function scrollToEnd(device: AndroidDevice, list: AndroidSelector, footer: AndroidSelector): Promise<void> {
  let previous: unknown;
  let unchanged = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { bounds } = await device.info(list);
    const horizontal = String(Math.round(bounds.x + bounds.width - 2));
    adb('shell', 'input', 'swipe', horizontal, String(Math.round(bounds.y + bounds.height * 0.85)),
      horizontal, String(Math.round(bounds.y + bounds.height * 0.2)), '600');
    let settled: unknown;
    await expect(async () => {
      const { bounds: current } = await device.info(footer);
      const before = settled;
      settled = current;
      expect(current.height).toBeGreaterThan(0);
      expect(current.y + current.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(current, '等待滑动后的页脚位置稳定').toEqual(before);
    }).toPass({ timeout: 10_000, intervals: [300] });
    unchanged = JSON.stringify(previous) === JSON.stringify(settled) ? unchanged + 1 : 0;
    if (unchanged === 2) return;
    previous = settled;
  }
  throw new Error('真实滑动未能抵达稳定的列表末尾。');
}
