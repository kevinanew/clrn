import type { Locator, Page } from '@playwright/test';
import { expect } from './proxy';
import { ensureLocalImagesLoaded } from '../../src/support/pageStabilizers';
import type { VisualScenario } from '../../scenarioTypes';

/**
 * 定位当前页面可见的测试元素，排除导航历史中的隐藏副本。
 * @param page - 执行操作的 Playwright 页面。
 * @param id - 目标控件的测试标记。
 */
export const visible = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });

/**
 * 仅对代理刻意挂起的列表请求暂停 XHR 截止时间；响应仍完整经过 mitmproxy。
 * @param page - 执行操作的 Playwright 页面。
 * @param hold - 是否暂缓接口响应以截取加载状态。
 */
export async function holdListDeadline(page: Page, hold: boolean): Promise<void> {
  await page.evaluate(enabled => {
    const state = window as typeof window & { recordListHeld?: boolean; recordDeadlineInstalled?: boolean };
    state.recordListHeld = enabled;
    if (state.recordDeadlineInstalled) return;
    state.recordDeadlineInstalled = true;
    const requests = new WeakMap<XMLHttpRequest, string>();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    /**
     * 记录每个 XHR 的目标地址，并保持原始 open 调用语义。
     * @param method - HTTP 请求方法。
     * @param url - 原始请求地址。
     * @param args - async、用户名和密码等剩余 open 参数。
     */
    XMLHttpRequest.prototype.open = function(method, url, ...args: unknown[]) {
      requests.set(this, String(url));
      return Reflect.apply(open, this, [method, url, ...args]);
    };
    /**
     * 仅在代理挂起战绩列表时取消 XHR 截止时间，其他请求保持原行为。
     * @param body - 原始请求正文。
     */
    XMLHttpRequest.prototype.send = function(body) {
      const url = requests.get(this) ?? '';
      if (state.recordListHeld && /\/v(?:10\/texas_holdem\/user\/[^/]+\/game_records|11\/game_log\/[^/]+\/play_session_record\/recent)(?:\?|$)/.test(url)) {
        this.timeout = 0;
      }
      return send.call(this, body);
    };
  }, hold);
}

/**
 * 点击当前页面可见的测试元素。
 * @param page - 执行操作的 Playwright 页面。
 * @param id - 目标控件的测试标记。
 */
export async function click(page: Page, id: string): Promise<void> {
  const target = visible(page, id);
  await expect(target).toHaveCount(1);
  // 目的页面由后续定位断言确认，避免回退时等待无关资源的完整 load。
  await target.click({ noWaitAfter: true });
}

/**
 * 通过战绩页导航返回上级页面。
 * @param page - 执行操作的 Playwright 页面。
 * @param detail - 是否从战绩详情返回。
 */
export async function back(page: Page, detail = false): Promise<void> {
  await click(page, detail ? 'back-button' : 'navigation-bar-back-image');
}

/**
 * 重新打开我的战绩页面并等待列表就绪。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function reopen(page: Page): Promise<void> {
  await back(page);
  // 等待列表真正退出，避免导航过渡中再次点击入口仍命中旧页面。
  await expect(page.getByTestId('my-game-record-list')).toHaveCount(0);
  await click(page, 'game-record');
  await expect(visible(page, 'my-game-record-list')).toHaveCount(1);
}

/**
 * 滚动战绩列表到开头或末尾，并触发列表的滚动处理。
 * @param page - 执行操作的 Playwright 页面。
 * @param end - 是否滚动到列表末尾；否则回到开头。
 */
export async function scrollList(page: Page, end: boolean): Promise<void> {
  await visible(page, 'my-game-record-list').evaluate((node, atEnd) => {
    const element = node as HTMLElement;
    element.scrollTop = atEnd ? element.scrollHeight : 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, end);
}

/**
 * 按战绩版本和房间名称定位对应的可见记录行。
 * @param page - 执行操作的 Playwright 页面。
 * @param name - 记录中显示的房间名称。
 * @param version - 战绩页面版本：legacy 或 v2。
 */
export function row(page: Page, name: string, version: 'legacy' | 'v2'): Locator {
  const id = version === 'legacy' ? 'right-content-button' : 'record-visual-record-';
  return page.locator(version === 'legacy'
    ? `[data-testid="${id}"]:visible` : `[data-testid^="${id}"]:visible`)
    .filter({ has: page.getByTestId('room-name-text').filter({ hasText: name }) });
}

/**
 * 通过 CDP 模拟向左滑动，显示记录行的删除按钮。
 * @param page - 执行操作的 Playwright 页面。
 * @param target - 待滚动、侧滑或验证的元素定位器。
 */
export async function swipe(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.8;
  const y = box!.y + box!.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 15; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x - step * 130 / 15, y }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

/**
 * 截图时检查图片和页面错误，避免将空白或缺图写入基准。
 * @param page - 执行操作的 Playwright 页面。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 */
export function captureStates(page: Page, scenario: VisualScenario) {
  let index = 0;
  return {
    /**
     * 推进页面动效并按当前场景标签保存指定状态的截图。
     * @param state - 用于截图文件名的场景状态。
     */
    snapshot: async (state: string) => {
      expect(state, '截图顺序必须与覆盖清单一致').toBe(scenario.snapshotStates![index++]);
      const dialog = ['delete_confirm', 'delete_blocked', 'delete_failure', 'list_failure', 'detail_failure'].includes(state);
      if (!dialog) await expect(visible(page, 'alert-message-text'), '普通状态不能被错误弹窗遮挡').toHaveCount(0);
      await ensureLocalImagesLoaded(page);
      await expect(page).toHaveScreenshot(`${scenario.label}_${state}.png`, { timeout: 90_000 });
      if (!dialog) await expect(visible(page, 'alert-message-text')).toHaveCount(0);
    },
    /** 确认本场景要求的截图状态全部执行，防止覆盖清单遗漏。 */
    complete: () => expect(index).toBe(scenario.snapshotStates!.length),
  };
}
