import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 底部弹层按固定视口裁切，禁止预热和焦点恢复引起的文档滚动，保留弹层内部滚动及动画。
 * @param page - 已进入私人房间页面的浏览器页面。
 * @param entrance - 背景页面中的弹层入口，用于固定其祖先的隐藏溢出容器。
 */
export async function lockBottomSheetDocumentScroll(page: Page, entrance?: Locator): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    Object.assign(document.documentElement.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', overflow: 'clip',
    });
    // body 的 overflow:hidden 仍允许焦点恢复触发程序滚动，且不会反映在 window.scrollY。
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
    document.body.style.overflow = 'clip';
  });
  // RN Web 导航容器的 overflow:hidden 也能被焦点恢复滚动，独立于 html/body。
  // 只处理入口的祖先，保留列表及弹层内部 overflow:auto/scroll 的正常滚动。
  await entrance?.evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== 'hidden' || style.overflowY !== 'hidden') continue;
      parent.scrollTop = 0;
      parent.scrollLeft = 0;
      parent.style.overflow = 'clip';
    }
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.body.scrollTop)).toBe(0);
}
