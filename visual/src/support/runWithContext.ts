import type { BrowserContext } from '@playwright/test';

/**
 * 在关闭浏览器 context 前等待其中的异步工作完全结束。
 * @param context - 首次导航前配置的浏览器上下文。
 * @param task - 在已准备好的上下文或代理上执行的异步任务。
 */
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
