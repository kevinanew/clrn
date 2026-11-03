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

/**
 * 底部弹层挂载后恢复固定裁切使用的页面原点，避免根滚动将背景和导航整体移位。
 * @param page - 时钟已暂停且弹层已挂载的页面。
 */
export async function resetViewportScroll(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));
  await settleLayout(page);
}
