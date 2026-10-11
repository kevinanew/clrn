import { expect, type Locator, type Page } from '@playwright/test';
import { unique } from './page';

/**
 * 兼容直接标记的输入框与 RN 包装容器，仍检查当前页面内的唯一性。
 * @param page - 执行操作的 Playwright 页面。
 * @param testId - 目标元素的测试标记。
 */
export async function formInput(page: Page, testId: string): Promise<Locator> {
  const root = await unique(page, testId);
  if (await root.evaluate(element => element.matches('input, textarea'))) return root;
  const input = root.locator('input, textarea').filter({ visible: true });
  await expect(input, `${testId} 内应只有一个输入框`).toHaveCount(1);
  return input;
}
