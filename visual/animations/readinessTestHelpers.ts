/** 离线就绪测试共用的失败响应和旧请求等待。 */
import { expect, type Page } from '@playwright/test';

/**
 * 等待页面确认旧请求已完成。
 * @param page - 测试页面。
 */
export async function waitForStaleRead(page: Page): Promise<void> {
  await expect.poll(/** 读取旧请求的完成标记。 */ () => page.evaluate(/** 读取页面中的完成标记。 */ () =>
    (window as typeof window & { staleReadFinished?: boolean }).staleReadFinished)).toBe(true);
}

/**
 * 打开离线页面并暂停测试时钟。
 * @param page - 测试页面。
 * @param origin - 离线页面地址。
 */
export async function pauseReadinessClock(page: Page, origin: string): Promise<void> {
  await page.goto(origin);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(/** 读取一秒后的页面时间。 */ () => Date.now() + 1000));
}
