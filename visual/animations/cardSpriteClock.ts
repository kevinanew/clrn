import type { Page } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

export type CardSpriteClock = 'frozen' | 'normal';
const normalPages = new WeakSet<Page>();

/**
 * 标记独立正常时间取证页；该页不安装虚拟时钟或暂停 CSS。
 * @param page - 本轮新建的页面。
 */
export function useNormalCardSpriteClock(page: Page): void { normalPages.add(page); }

/**
 * 判断该页是否使用浏览器原生时间。
 * @param page - 当前页面。
 */
export function hasNormalCardSpriteClock(page: Page): boolean { return normalPages.has(page); }

/**
 * 正常时间页只等待真实时间，其他页面保持原有虚拟时钟调用。
 * @param page - 当前页面。
 * @param milliseconds - 原有推进间隔。
 */
export async function advanceCardSpriteClock(page: Page, milliseconds: number): Promise<void> {
  if (hasNormalCardSpriteClock(page)) await delay(milliseconds);
  else await page.clock.runFor(milliseconds);
}
