import type { Page, TestInfo } from '@playwright/test';

/** 在截图之后只读记录横幅子节点，区分旧 RAF、未提交变换和缺图；不推进时钟。
 * @param page - 保持暂停的页面。
 * @param info - 当前用例附件。
 * @param name - 原动画名称。
 * @param snapshot - 已完成采样的帧名。
 */
export async function recordSlotBannerFrame(page: Page, info: TestInfo, name: string, snapshot: string): Promise<void> {
  if (name !== 'hall-slot-banner') return;
  try {
    const nodes = await page.getByTestId('slot-banner').locator('*').evaluateAll(/** 仅读取节点的样式和缺图状态，不输出地址及文本。
     * @param elements - 横幅的子节点。
     */ elements => elements.map(/** 记录一个子节点的绘制状态。
      * @param node - 当前子节点。
      */ node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { tag: node.tagName, transform: style.transform, filter: style.filter,
        opacity: style.opacity, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        image: node instanceof HTMLImageElement
          ? { complete: node.complete, width: node.naturalWidth, height: node.naturalHeight } : null };
    }));
    await info.attach(`${snapshot}-banner-state`, {
      body: JSON.stringify(nodes), contentType: 'application/json',
    });
  } catch { /* 诊断失败不得覆盖截图异常或改变测试结果。 */ }
}
