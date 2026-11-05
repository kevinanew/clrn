/** 不改变应用动画和时钟，画面稳定后保存登录后的证据截图。 */
import { expect, type Page } from '@playwright/test';

/** 采集弹窗及祖先的几何和透明度，不读取认证或业务请求内容。 */
function presentation(): { signature: string; animating: boolean } {
  const elements = new Set<Element>();
  const targets = '[data-testid="run-game-view"], [data-testid="common-alert-message"], '
    + '[data-testid="toastText1"], [data-testid="alert-message-text"]';
  for (const target of Array.from(document.querySelectorAll(targets))) {
    let element: Element | null = target;
    while (element && element !== document.body) {
      elements.add(element);
      element = element.parentElement;
    }
  }
  const geometry = [...elements].map(/** 保留实际位置、大小、缩放和透明度。
   * @param element - 牌桌或弹窗相关节点。 */ element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return [bounds.x, bounds.y, bounds.width, bounds.height, style.opacity, style.transform];
  });
  const animating = document.getAnimations().some(/** 只等待有限动画，不等待循环加载动画。
   * @param animation - 浏览器当前动画。 */ animation => animation.effect?.getComputedTiming().endTime !== Infinity
      && (animation.playState === 'running' || animation.pending));
  return { signature: JSON.stringify(geometry), animating };
}

/**
 * 在真实布局连续稳定 500 毫秒后截图，超时即失败。
 * @param page - 当前已登录页面。
 * @param destination - 本轮证据文件路径。
 */
export async function capture(page: Page, destination: string): Promise<void> {
  let signature = '';
  let stableSince = Date.now();
  await expect.poll(/** 不冻结页面；真实动画或布局变化都会重新计时。 */ async () => {
    const sample = await page.evaluate(presentation);
    if (sample.animating || sample.signature !== signature) stableSince = Date.now();
    signature = sample.signature;
    return Date.now() - stableSince >= 500;
  }, { intervals: [50], timeout: 10_000 }).toBe(true);
  await page.screenshot({ path: destination });
}
