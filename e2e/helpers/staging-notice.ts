import type { Page } from '@playwright/test';

/**
 * 按测试版提示实际输入当前语言的确认文字，再点击进入；兼容旧版无输入框提示。
 * @param page - 已导航到应用的 Playwright 页面。
 * @returns 当前是否处理了测试版提示。
 */
export async function confirmStagingNotice(page: Page): Promise<boolean> {
  const dialog = page.getByTestId('staging-dialog');
  if (!await dialog.isVisible()) return false;
  const input = dialog.locator('input[data-testid="staging-confirmation-input"], [data-testid="staging-confirmation-input"] input').first();
  if (await input.count()) {
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    const confirmation = (await input.getAttribute('placeholder'))?.trim();
    if (!confirmation) throw new Error('测试版确认输入框缺少当前语言的确认文字');
    await input.fill(confirmation);
  }
  const confirm = dialog.getByTestId('confirm-button');
  // 正常点击会等待按钮启用；共享模块不加载另一套 Playwright 运行时。
  await confirm.click({ timeout: 15_000, noWaitAfter: true });
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
  return true;
}
