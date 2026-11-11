/** 德州初始化期间持续检查完整就绪状态，并只通过应用重试入口恢复连接。 */
import { expect, type Page } from '@playwright/test';
import { recordDiagnostic } from '../../src/support/connectionDiagnostics';

const required = ['countdown-text', 'texas-holdem-start-room-timer-button',
  'menu-button', 'texas-holdem-leaderboard-button'];
const blockers = ['game-splash-screen-bg', 'common-alert-container', 'common-alert-button-retry'];
const selector = [...required, ...blockers].map(
  /** 只读取初始化相关控件，忽略导航历史中的隐藏副本。
   * @param id - 控件的测试标记。
   */ id => `[data-testid="${id}"]:visible`,
).join(',');
const retryLimit = 3;

/** 在预算内点击重试按钮。
 * @param page - 当前页面。
 * @param attempts - 已重试次数。
 * @param deadline - 初始化截止时间。
 * @param cache - 当前重试的健康缓存截止时间。
 */
async function retryConnection(page: Page, attempts: number, deadline: number, cache: { retryAfter: number }): Promise<number> {
  if (!retryAllowed(attempts, deadline)) return attempts;
  // 复用动画入口的十秒缓存等待，避免立即点击耗尽重试却没有重新探测。
  if (!cacheExpired(cache)) return attempts;
  cache.retryAfter = 0;
  recordDiagnostic(page, '点击应用重试按钮', { attempt: ++attempts, limit: retryLimit });
  await page.locator('[data-testid="common-alert-button-retry"]:visible').last()
    .click({ timeout: Math.max(1, Math.min(5000, deadline - Date.now())) });
  return attempts;
}

/** 从弹窗出现后等待最后一批健康缓存过期。
 * @param cache - 当前重试的缓存截止时间。 */
function cacheExpired(cache: { retryAfter: number }): boolean {
  cache.retryAfter ||= Date.now() + 10_000;
  return Date.now() >= cache.retryAfter;
}

/** 保留重试次数和总预算限制。
 * @param attempts - 已重试次数。
 * @param deadline - 初始化截止时间。 */
function retryAllowed(attempts: number, deadline: number): boolean {
  return attempts < retryLimit && Date.now() < deadline;
}

/**
 * 在同一时间预算内等待倒计时、房主开始按钮和工具栏，期间处理晚到的重试弹窗。
 * @param page - 执行操作的 Playwright 页面。
 * @param timeout - 整个初始化流程的时间预算，包含重试点击耗时。
 */
export async function waitForGameConnection(page: Page, timeout = 90_000): Promise<void> {
  const deadline = Date.now() + timeout;
  let attempts = 0;
  const cache = { retryAfter: 0 };
  let previous: string | undefined;
  try {
    await expect.poll(/** 持续检查业务控件和阻塞弹层，直到完整就绪或预算耗尽。 */ async () => {
      const visible = await page.locator(selector).evaluateAll(
        /** 同次 DOM 读取保留倒计时、房主控件和弹窗的相对时序。
         * @param elements - 当前可见的初始化控件。
         */ elements => elements.map(
          /** 只返回测试标记，不采集页面正文、房号或凭据。
           * @param element - 当前可见的 DOM 元素。
           */ element => element.getAttribute('data-testid')!,
        ),
      );
      const state = visible.join(',');
      if (state !== previous) {
        recordDiagnostic(page, '德州初始化状态', { target: visible, attempt: attempts });
        previous = state;
      }
      if (visible.includes('common-alert-button-retry')) {
        attempts = await retryConnection(page, attempts, deadline, cache);
        return false;
      }
      return required.every(/** 所有业务就绪标记必须同时可见。
       * @param id - 必须出现的测试标记。 */ id => visible.includes(id))
        && !blockers.some(/** 加载遮罩或错误弹窗仍在时禁止进入截图。
         * @param id - 阻塞初始化的测试标记。 */ id => visible.includes(id));
    }, { timeout, intervals: [100, 250, 500, 1000], message: '德州牌桌应完整就绪，且无加载遮罩或错误弹窗' }).toBe(true);
    recordDiagnostic(page, '德州初始化完成', { attempt: attempts });
  } catch (error) {
    recordDiagnostic(page, '德州初始化失败', { attempt: attempts, limit: retryLimit, timeoutMs: timeout });
    throw error;
  }
}
