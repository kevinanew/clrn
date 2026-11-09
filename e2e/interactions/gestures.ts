import { expect, type Locator, type Page } from '@playwright/test';

export type Point = { x: number; y: number };

/**
 * 通过浏览器输入系统拖动；触屏发送完整触摸序列，不修改 DOM 或调用业务回调。
 * @param page - 执行交互的 Playwright 页面。
 * @param from - 拖动起点的视口坐标。
 * @param to - 拖动终点的视口坐标。
 * @param touch - 是否通过触屏输入执行手势。
 */
export async function drag(page: Page, from: Point, to: Point, touch: boolean): Promise<void> {
  const input = await dragInput(page, touch);
  try {
    await input.start(from);
    for (let step = 1; step <= 12; step += 1) {
      await input.move({ x: from.x + ((to.x - from.x) * step) / 12,
        y: from.y + ((to.y - from.y) * step) / 12 });
      // 保留手势时间，确保浏览器和 RN 能识别移动。
      await page.waitForTimeout(20);
    }
  } finally { await input.finish(); }
}

/**
 * 建立真实鼠标或 CDP 触摸输入序列，保留结束及 detach 的顺序。
 * @param page - 当前页面。
 * @param touch - 是否使用触摸。
 */
async function dragInput(page: Page, touch: boolean) {
  if (!touch) return {
    /** 开始鼠标拖动。
     * @param point - 起点。 */
    async start(point: Point) { await page.mouse.move(point.x, point.y); await page.mouse.down(); },
    /** 移动真实鼠标。
     * @param point - 当前坐标。 */
    async move(point: Point) { await page.mouse.move(point.x, point.y); },
    /** 释放鼠标。 */
    async finish() { await page.mouse.up(); },
  };
  const session = await page.context().newCDPSession(page);
  return {
    /** 开始真实触摸。
     * @param point - 起点。 */
    async start(point: Point) { await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }); },
    /** 移动同一触点。
     * @param point - 当前坐标。 */
    async move(point: Point) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] }); },
    /** 结束触摸后释放会话。 */
    async finish() { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach(); },
  };
}

/**
 * 在容器可见区域输入滚轮或触摸滑动，方向表示内容的滚动方向。
 * @param page - 执行交互的 Playwright 页面。
 * @param container - 接收滚动输入的可见列表容器。
 * @param touch - 是否通过触屏输入执行手势。
 * @param direction - 内容滚动方向，正数向下，负数向上。
 */
export async function scroll(
  page: Page,
  container: Locator,
  touch: boolean,
  direction = 1,
): Promise<void> {
  // 原始滚轮和 CDP 触摸不会触发 locator handler；先确认容器未被弹窗遮挡。
  // trial 不会点击列表，也不会触发条目业务操作。
  await container.click({ trial: true });
  const box = await container.boundingBox();
  if (!box) {
    throw new Error('滚动容器必须有布局区域');
  }
  const viewport = await page.evaluate(
    /** 读取布局视口大小。 */ () => ({ width: innerWidth, height: innerHeight }),
  );
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, viewport.height - 60);
  expect(bottom - top, '滚动容器必须在视口内').toBeGreaterThan(60);
  const x = Math.min(box.x + box.width * 0.5, viewport.width - 20);
  await scrollInput(page, touch, { x, top, bottom }, direction);
  // 等待滚轮分发和触摸惯性，再读取滚动结果。
  await page.waitForTimeout(300);
}

/**
 * 只通过真实输入寻找首屏外的条目，兼容尚未挂载的虚拟列表单元。
 * @param page - 执行交互的 Playwright 页面。
 * @param container - 接收滚动输入的可见列表容器。
 * @param target - 需要通过实际滚动带入视口的目标条目。
 * @param touch - 是否通过触屏输入执行手势。
 */
export async function scrollToItem(
  page: Page,
  container: Locator,
  target: Locator,
  touch: boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    if (await itemInsideViewport(target)) {
      await expect(target).toBeInViewport();
      return;
    }
    await scroll(page, container, touch);
  }
  const metrics = await container.evaluate(
    /**
     * 记录滚动范围和已挂载内容，区分列表停止渲染与目标定位错误。
     * @param el - 当前查询布局或滚动位置的 DOM 元素。
     */ (el) => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      text: (el as HTMLElement).innerText,
    }),
  );
  throw new Error(`真实滚动后仍无法到达目标条目：${JSON.stringify(metrics)}`);
}

/**
 * 在已计算的可见区域输入滚轮或触摸滚动。
 * @param page - 当前页面。
 * @param touch - 输入类型。
 * @param area - 可见滚动区域。
 * @param direction - 内容方向。
 */
async function scrollInput(page: Page, touch: boolean, area: { x: number; top: number; bottom: number }, direction: number): Promise<void> {
  if (touch) await touchScroll(page, area, direction);
  else {
    await page.mouse.move(area.x, (area.top + area.bottom) / 2);
    await page.mouse.wheel(0, direction * (area.bottom - area.top) * 0.8);
  }
}

/**
 * 按原有三十像素边距选择上下滑动起终点。
 * @param page - 当前页面。
 * @param area - 可见区域。
 * @param direction - 内容方向。
 */
async function touchScroll(page: Page, area: { x: number; top: number; bottom: number }, direction: number): Promise<void> {
  const startY = direction > 0 ? area.bottom - 30 : area.top + 30;
  const endY = direction > 0 ? area.top + 30 : area.bottom - 30;
  await drag(page, { x: area.x, y: startY }, { x: area.x, y: endY }, true);
}

/**
 * 只读取已挂载目标是否完全进入原有视口边界。
 * @param target - 当前目标条目。
 */
async function itemInsideViewport(target: Locator): Promise<boolean> {
  if (!await target.count()) return false;
  return target.evaluate(/** 测量目标边界。
   * @param el - 目标元素。 */ el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 60 && rect.bottom <= innerHeight + 1;
  });
}
