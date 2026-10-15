import { expect } from '@playwright/test';
import type { AndroidDevice, AndroidSelector } from 'playwright';

/**
 * 查询控件是否可见；排除屏外历史弹层，只把查找空指针识别为不存在。
 * @param device - 专用模拟器连接。
 * @param selector - 原生控件条件。
 */
export async function exists(device: AndroidDevice, selector: AndroidSelector): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { bounds } = await device.info(selector);
      return bounds.width > 0 && bounds.height > 0 && bounds.x < 720 && bounds.y < 1280
        && bounds.x + bounds.width > 0 && bounds.y + bounds.height > 0;
    }
    catch (error) {
      if (/NullPointerException|UiObjectNotFoundException/.test(String(error))) return false;
      // 转场中查到的对象可能随即卸载，重新查询新控件树，不将过期对象当作消失。
      if (/StaleObjectException/.test(String(error)) && attempt < 4) continue;
      throw error;
    }
  }
}

/**
 * 等待控件消失；当前 Playwright Android 驱动的 wait 实现未处理 gone 状态。
 * @param device - 专用模拟器连接。
 * @param selector - 应从控件树中移除的目标。
 */
export async function waitAbsent(device: AndroidDevice, selector: AndroidSelector): Promise<void> {
  await expect.poll(() => exists(device, selector), { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(false);
}
