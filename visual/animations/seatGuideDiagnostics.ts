import type { Page, TestInfo } from '@playwright/test';

/** 失败帧之后只读保存座位箭头相位，不推进时钟或改变原截图。
 * @param page - 保持暂停的牌桌。
 * @param info - 原测试报告。
 * @param snapshot - 已完成比较的帧名。 */
export async function recordSeatGuideFailure(page: Page, info: TestInfo, snapshot: string): Promise<void> {
  try {
    const arrows = await page.locator('[data-testid^="seat-guide-"] img').locator('..')
      .evaluateAll(/** 只读取几何及动画时间，不收集文本、标识或资源地址。
       * @param nodes - 原页面中的全部箭头。 */ nodes => nodes.map(/** 保存当前箭头绘制相位。
        * @param node - 当前箭头。 */ node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, transform: style.transform, opacity: style.opacity,
          animations: node.getAnimations().map(/** 读取动画时间，不暂停或重置动画。
           * @param animation - 当前节点的动画。 */ animation => ({
            currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
            playState: animation.playState, progress: animation.effect?.getComputedTiming().progress,
          })) };
      }));
    await info.attach(`${snapshot}-seat-guide-state`, { body: JSON.stringify(arrows), contentType: 'application/json' });
  } catch { /* 诊断失败不得改变原比较结果。 */ }
}
