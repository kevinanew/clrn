import { expect, type Page } from '@playwright/test';

/**
 * 底部弹层按固定视口裁切，禁止预热和焦点恢复引起的文档滚动，保留弹层内部滚动及动画。
 * @param page - 已进入私人房间页面的浏览器页面。
 */
export async function lockBottomSheetDocumentScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    Object.assign(document.documentElement.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', overflow: 'clip',
    });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}
