import { expect, type Locator, type Page } from '@playwright/test';

type Point = { x: number; y: number };

/**
 * 通过浏览器输入系统拖动；触屏发送完整触摸序列，不修改 DOM 或调用业务回调。
 * @param page - 执行交互的 Playwright 页面。
 * @param from - 拖动起点的视口坐标。
 * @param to - 拖动终点的视口坐标。
 * @param touch - 是否通过触屏输入执行手势。
 */
export async function drag(page: Page, from: Point, to: Point, touch: boolean): Promise<void> {
  const session = touch ? await page.context().newCDPSession(page) : null;
  try {
    if (session) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...from, id: 1 }],
      });
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
    }
    for (let step = 1; step <= 12; step += 1) {
      const point = {
        x: from.x + ((to.x - from.x) * step) / 12,
        y: from.y + ((to.y - from.y) * step) / 12,
      };
      if (session) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ ...point, id: 1 }],
        });
      } else {
        await page.mouse.move(point.x, point.y);
      }
      // 保留手势时间，确保浏览器和 RN 能识别移动，而不是一次跳跃点击。
      await page.waitForTimeout(20);
    }
  } finally {
    if (session) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.up();
    }
  }
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
  if (touch) {
    const startY = direction > 0 ? bottom - 30 : top + 30;
    const endY = direction > 0 ? top + 30 : bottom - 30;
    await drag(page, { x, y: startY }, { x, y: endY }, true);
  } else {
    await page.mouse.move(x, (top + bottom) / 2);
    await page.mouse.wheel(0, direction * (bottom - top) * 0.8);
  }
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
    if (await target.count()) {
      const inside = await target.evaluate(
        /**
         * 检查目标是否完全进入视口。
         * @param el - 当前查询布局或滚动位置的 DOM 元素。
         */ (el) => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 60 && rect.bottom <= innerHeight + 1;
        },
      );
      if (inside) {
        await expect(target).toBeInViewport();
        return;
      }
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
