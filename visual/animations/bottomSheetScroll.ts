import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 底部弹层按固定视口裁切，禁止预热和焦点恢复引起的文档滚动，保留弹层内部滚动及动画。
 * @param page - 已进入私人房间页面的浏览器页面。
 * @param entrance - 背景页面中的弹层入口，用于固定其祖先的隐藏溢出容器。
 */
export async function lockBottomSheetDocumentScroll(page: Page, entrance?: Locator): Promise<void> {
  await page.evaluate(/** 锁定文档与 body 的尺寸和溢出行为，防止弹层动画推动视口。 */ () => {
    window.scrollTo(0, 0);
    Object.assign(document.documentElement.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', overflow: 'clip',
    });
    // body 的 overflow:hidden 仍允许焦点恢复触发程序滚动，且不会反映在 window.scrollY。
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
    document.body.style.overflow = 'clip';
    // 固定底部导航的隐藏溢出祖先，同时保留列表的独立滚动。
    const navigation = document.querySelector('[data-testid="private-room-tab"]');
    for (let node = navigation?.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'hidden' || style.overflowY !== 'hidden') continue;
      node.scrollTop = 0;
      node.scrollLeft = 0;
      node.style.overflow = 'clip';
    }
  });
  // 入口也可能位于独立的隐藏溢出容器中。
  await entrance?.evaluate(/** 沿入口元素的隐藏溢出祖先复位滚动，清除焦点恢复留下的位移。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== 'hidden' || style.overflowY !== 'hidden') continue;
      parent.scrollTop = 0;
      parent.scrollLeft = 0;
      parent.style.overflow = 'clip';
    }
  });
  await expect.poll(/** 轮询窗口偏移，等待文档锁定恢复视口原点。 */ () => page.evaluate(/** 读取窗口的实际滚动偏移，供原点断言使用。 */ () => window.scrollY)).toBe(0);
  await expect.poll(/** 轮询 body 偏移，等待独立滚动层恢复原点。 */ () => page.evaluate(/** 读取 body 的实际滚动偏移，供锁定完成断言使用。 */ () => document.body.scrollTop)).toBe(0);
}
