import type { Locator, Page } from '@playwright/test';
import { expect } from './proxy';
import { ensureLocalImagesLoaded } from '../../src/support/pageStabilizers';
import type { VisualScenario } from '../../scenarioTypes';

export const visible = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });

/** 仅对代理刻意挂起的列表请求暂停 XHR 截止时间；响应仍完整经过 mitmproxy。 */
export async function holdListDeadline(page: Page, hold: boolean): Promise<void> {
  await page.evaluate(enabled => {
    const state = window as typeof window & { recordListHeld?: boolean; recordDeadlineInstalled?: boolean };
    state.recordListHeld = enabled;
    if (state.recordDeadlineInstalled) return;
    state.recordDeadlineInstalled = true;
    const requests = new WeakMap<XMLHttpRequest, string>();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...args: unknown[]) {
      requests.set(this, String(url));
      return Reflect.apply(open, this, [method, url, ...args]);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const url = requests.get(this) ?? '';
      if (state.recordListHeld && /\/v(?:10\/texas_holdem\/user\/[^/]+\/game_records|11\/game_log\/[^/]+\/play_session_record\/recent)(?:\?|$)/.test(url)) {
        this.timeout = 0;
      }
      return send.call(this, body);
    };
  }, hold);
}

export async function click(page: Page, id: string): Promise<void> {
  const target = visible(page, id);
  await expect(target).toHaveCount(1);
  // 目的页面由后续定位断言确认，避免回退时等待无关资源的完整 load。
  await target.click({ noWaitAfter: true });
}

export async function back(page: Page, detail = false): Promise<void> {
  await click(page, detail ? 'back-button' : 'navigation-bar-back-image');
}

export async function scrollList(page: Page, end: boolean): Promise<void> {
  await visible(page, 'my-game-record-list').evaluate((node, atEnd) => {
    const element = node as HTMLElement;
    element.scrollTop = atEnd ? element.scrollHeight : 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, end);
}

export function row(page: Page, name: string, version: 'legacy' | 'v2'): Locator {
  const id = version === 'legacy' ? 'right-content-button' : 'record-visual-record-';
  return page.locator(version === 'legacy'
    ? `[data-testid="${id}"]:visible` : `[data-testid^="${id}"]:visible`)
    .filter({ has: page.getByTestId('room-name-text').filter({ hasText: name }) });
}

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

/** 截图时检查图片和页面错误，避免将空白或缺图写入基准。 */
export function captureStates(page: Page, scenario: VisualScenario) {
  let index = 0;
  return {
    snapshot: async (state: string) => {
      expect(state, '截图顺序必须与覆盖清单一致').toBe(scenario.snapshotStates![index++]);
      const dialog = ['delete_confirm', 'delete_blocked', 'delete_failure', 'list_failure', 'detail_failure'].includes(state);
      if (!dialog) await expect(visible(page, 'alert-message-text'), '普通状态不能被错误弹窗遮挡').toHaveCount(0);
      await ensureLocalImagesLoaded(page);
      await expect(page).toHaveScreenshot(`${scenario.label}_${state}.png`, { timeout: 90_000 });
      if (!dialog) await expect(visible(page, 'alert-message-text')).toHaveCount(0);
    },
    complete: () => expect(index).toBe(scenario.snapshotStates!.length),
  };
}
