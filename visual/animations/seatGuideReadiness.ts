import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 逐毫秒观察真实循环起点，避免跨过只维持到下一次 RAF 的复位帧。
 *
 * @param page - 时钟已暂停的牌桌。
 *
 * @param arrows - 全部空座引导的动画容器。
 */
export async function waitForSeatGuideStart(page: Page, arrows: Locator): Promise<void> {
  await expect(arrows).toHaveCount(9);
  await expect.poll(/** 等待所有箭头复位。 */ async () => {
    const offsets = await arrows.evaluateAll(/** 读取所有箭头位移。
 * @param nodes - 箭头节点。 */ nodes => nodes.map(/** 读取单个箭头位移。
 * @param node - 箭头节点。 */ node =>
      new DOMMatrixReadOnly(getComputedStyle(node).transform).m42));
    if (offsets.length === 9 && offsets.every(/** 判断箭头是否复位。
 * @param offset - 箭头位移。 */ offset => Math.abs(offset) < 0.1)) return true;
    await page.clock.runFor(1);
    return false;
  }, { timeout: 30_000, intervals: [0], message: '全部空座引导应回到真实循环起点' }).toBe(true);
}
