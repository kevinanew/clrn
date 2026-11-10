/** 德州初始化期间持续检查完整就绪状态，并只通过应用重试入口恢复连接。 */
import { errors, expect, type Page } from '@playwright/test';
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

/**
 * 在同一时间预算内等待倒计时、房主开始按钮和工具栏，期间处理晚到的重试弹窗。
 * @param page - 执行操作的 Playwright 页面。
 * @param timeout - 整个初始化流程的时间预算，包含重试点击耗时。
 */
export async function waitForGameConnection(page: Page, timeout = 90_000): Promise<void> {
  const deadline = Date.now() + timeout;
  let attempts = 0;
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
        if (attempts < retryLimit && Date.now() < deadline) {
          recordDiagnostic(page, '点击应用重试按钮', { attempt: ++attempts, limit: retryLimit });
          await page.locator('[data-testid="common-alert-button-retry"]:visible').last()
            .click({ timeout: Math.max(1, Math.min(5000, deadline - Date.now())) });
        }
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
    if (error instanceof errors.TimeoutError) {
      throw new Error('德州牌桌应完整就绪，且无加载遮罩或错误弹窗', { cause: error });
    }
    throw error;
  }
}
