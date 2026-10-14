import { expect } from '@playwright/test';
import type { AndroidDevice, AndroidSelector } from 'playwright';

/**
 * 查询控件是否存在，只把原生查找空指针识别为不存在，连接错误仍失败。
 * @param device - 专用模拟器连接。
 * @param selector - 原生控件条件。
 */
export async function exists(device: AndroidDevice, selector: AndroidSelector): Promise<boolean> {
  try { await device.info(selector); return true; }
  catch (error) {
    if (/NullPointerException|UiObjectNotFoundException/.test(String(error))) return false;
    throw error;
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
