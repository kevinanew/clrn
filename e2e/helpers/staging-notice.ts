// 仅声明实际使用的浏览器能力，避免两套独立测试环境互相要求安装 Playwright。
interface StagingNoticeLocator {
  getByTestId(testId: string): StagingNoticeLocator;
  locator(selector: string): StagingNoticeLocator;
  first(): StagingNoticeLocator;
  isVisible(): Promise<boolean>;
  count(): Promise<number>;
  waitFor(options: { state: 'visible' | 'hidden'; timeout: number }): Promise<void>;
  getAttribute(name: string): Promise<string | null>;
  fill(value: string): Promise<void>;
  click(options: { timeout: number; noWaitAfter: boolean }): Promise<void>;
}

interface StagingNoticePage {
  getByTestId(testId: string): StagingNoticeLocator;
}

/**
 * 按测试版提示实际输入当前语言的确认文字，再点击进入；兼容旧版无输入框提示。
 * @param page - 已导航到应用的 Playwright 页面。
 * @returns 当前是否处理了测试版提示。
 */
export async function confirmStagingNotice(page: StagingNoticePage): Promise<boolean> {
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
  // 确认后会同时初始化大厅；软件渲染的动画测试环境也沿用大厅的 60 秒就绪预算。
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
  return true;
}
