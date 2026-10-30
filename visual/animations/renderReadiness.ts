import type { Page } from '@playwright/test';
import { advanceCardSpriteClock } from './cardSpriteClock';

/**
 * 等待浏览器真实布局通知，再运行同一虚拟时刻的测量回调；不推进动画进度。
 * @param page - 时钟已暂停的页面。
 */
export async function settleLayout(page: Page): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(() => new Promise<void>(resolve => {
      const observer = new ResizeObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(document.documentElement);
    }));
    // RN Web 的 onLayout 经 ResizeObserver、零延迟回调和界面更新后才生效。
    await advanceCardSpriteClock(page, 0);
  }
}
