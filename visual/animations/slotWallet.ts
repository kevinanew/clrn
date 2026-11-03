import type { Locator } from '@playwright/test';
import type { NumericTextMask } from './numericMask';

/**
 * 仅选择老虎机工具栏里的两个余额，奖励数字和能量条继续参与视觉比较。
 * @param panel - 真实老虎机面板。
 */
export function slotWalletMask(panel: Locator): NumericTextMask[] {
  const container = panel.getByTestId('top-toolbar');
  return [{ container, locator: container.getByText(/^\d[\d,]*$/), expectedCount: 2 }];
}
