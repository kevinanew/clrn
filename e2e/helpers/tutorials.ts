// 只声明共用的页面能力，兼容独立安装的 E2E 和视觉 Playwright。
interface TutorialLocator {
  filter(options: { visible: boolean }): TutorialLocator;
  locator(selector: string): TutorialLocator;
  click(options: { timeout: number }): Promise<void>;
  waitFor(options: { state: 'hidden'; timeout: number }): Promise<void>;
}

interface TutorialPage {
  getByTestId(testId: string): TutorialLocator;
  addLocatorHandler(locator: TutorialLocator, handler: () => Promise<void>): Promise<void>;
}

const installed = new WeakSet<TutorialPage>();

/**
 * 通过 Copilot 的真实跳过／完成按钮关闭引导，由应用自行保存完成状态。
 * 只在带 stepDescription 的引导内寻找按钮，不处理业务弹窗或改写存储。
 * @param page - 将要打开应用的隔离页面。
 */
export async function installTutorialHandler(page: TutorialPage): Promise<void> {
  if (installed.has(page)) return;
  const description = page.getByTestId('stepDescription').filter({ visible: true });
  await page.addLocatorHandler(description, /** 找到当前引导提示所属容器并点击可见的跳过或完成按钮。 */ async () => {
    // react-native-copilot 3.3.3 的说明和按钮是同一 tooltip 下的两个子容器。
    const tooltip = description.locator('../..');
    await tooltip.locator('[data-testid="tooltip-skip-button"], [data-testid="tooltip-finish-button"]')
      .filter({ visible: true }).click({ timeout: 15_000 });
    await description.waitFor({ state: 'hidden', timeout: 15_000 });
  });
  installed.add(page);
}
