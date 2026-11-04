/** 截图前等待目标弹窗状态和画面稳定；保留真实动画，不提前截图或冻结页面。 */
import { expect, type Page } from '@playwright/test';

type ScreenshotState = { buyIn?: 'open' | 'closed'; commonAlert?: 'open' | 'closed' };

/** 读取弹窗、牌桌及其祖先的实际几何和样式，同时检测尚未结束的有限动画。 */
function presentation(): { signature: string; animating: boolean } {
  const elements = new Set<Element>();
  const targets = document.querySelectorAll(
    '[data-testid="run-game-view"], [data-testid="buy-in-title"], '
    + '[data-testid="common-alert-container"] > div, [data-testid="toastText1"]',
  );
  for (const target of Array.from(targets)) {
    if (!target.getClientRects().length) continue;
    let element: Element | null = target;
    while (element && element !== document.body) {
      elements.add(element);
      element = element.parentElement;
    }
  }
  const geometry = [...elements].map(element => {
    const rectangle = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return [rectangle.x, rectangle.y, rectangle.width, rectangle.height,
      style.opacity, style.transform, style.visibility];
  });
  const animating = document.getAnimations().some(animation => {
    const timing = animation.effect?.getComputedTiming();
    return Boolean(timing && timing.endTime !== Infinity
      && (animation.playState === 'running' || animation.pending));
  });
  return { signature: JSON.stringify(geometry), animating };
}

/**
 * 等待指定弹窗状态及连续 500 毫秒的稳定画面后，截取真实页面。
 * @param page - 当前真实业务页面。
 * @param path - 本轮截图输出路径。
 * @param state - 截图所需的带入弹窗和错误弹窗状态；关闭要求节点实际移除。
 */
export async function screenshotAfterSettling(page: Page, path: string,
  state: ScreenshotState = {}): Promise<void> {
  if (state.buyIn === 'closed') {
    await expect(page.getByTestId('texas-holdem-buy-in-popup-visible-marker'))
      .toHaveCount(0, { timeout: 10_000 });
  } else if (state.buyIn === 'open') {
    await expect(page.getByTestId('buy-in-title')).toBeVisible({ timeout: 10_000 });
  }
  if (state.commonAlert === 'closed') {
    await expect(page.getByTestId('common-alert-container')).toHaveCount(0, { timeout: 10_000 });
  } else if (state.commonAlert === 'open') {
    await expect(page.getByTestId('common-alert-message')).toBeVisible({ timeout: 10_000 });
  }
  let signature: string | undefined;
  let stableSince = Date.now();
  await expect.poll(async () => {
    const sample = await page.evaluate(presentation);
    if (sample.animating || sample.signature !== signature) stableSince = Date.now();
    signature = sample.signature;
    return Date.now() - stableSince >= 500;
  }, { message: '截图前动画必须结束，且几何和透明度连续稳定 500 毫秒',
    intervals: [50], timeout: 10_000 }).toBe(true);
  await page.screenshot({ path });
}
