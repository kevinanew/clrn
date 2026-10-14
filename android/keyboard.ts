import type { AndroidDevice } from 'playwright';
import { expect } from '@playwright/test';
import { adb } from './device';

/**
 * 收起真实输入法，并等待窗口完成隐藏，避免后续滑动变成键盘手势输入。
 * @param device - 专用模拟器连接。
 */
export async function dismissKeyboard(device: AndroidDevice): Promise<void> {
  await device.input.press('Back');
  await expect(async () => {
    const state = adb('shell', 'dumpsys', 'input_method');
    if (state.includes('mInputShown=true')) {
      await device.input.press('Back');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(state).toContain('mInputShown=false');
  }).toPass({ timeout: 30_000, intervals: [500] });
}
