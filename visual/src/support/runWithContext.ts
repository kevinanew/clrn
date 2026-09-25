import type { BrowserContext } from '@playwright/test';

/** 在关闭浏览器 context 前等待其中的异步工作完全结束。 */
export async function runWithContext<T>(
  context: BrowserContext,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } finally {
    await context.close();
  }
}
