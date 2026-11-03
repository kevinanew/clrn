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
    // body 的 overflow:hidden 仍允许焦点恢复触发程序滚动，且不会反映在 window.scrollY。
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
    document.body.style.overflow = 'clip';
    // RN Web 的应用壳也可能因底部导航溢出 1px 而独立滚动。
    // 只固定导航的祖先，保留页面列表及弹层内部的滚动容器。
    const navigation = document.querySelector('[data-testid="private-room-tab"]');
    for (let node = navigation?.parentElement; node && node !== document.body; node = node.parentElement) {
      node.scrollTop = 0;
      node.scrollLeft = 0;
      node.style.overflow = 'clip';
    }
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.body.scrollTop)).toBe(0);
}
