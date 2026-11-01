import { type Page, type Request } from '@playwright/test';
import { readRequestJson } from '../src/support/requestJson';
import { requestErrorSummary } from '../src/support/requestError';
import { press } from './appSession';

/**
 * 打开续时面板并等待本次真实读取，避免关闭后遗留请求的错误污染下一轮采样。
 * @param page - 虚拟时钟已暂停的牌桌页面。
 */
export async function openRenewPopup(page: Page): Promise<void> {
  const requests = new Set<Request>();
  /**
   * 只接受本次准备期间发出的请求，排除旧请求晚到的响应。
   * @param request - 浏览器新发出的请求。
   */
  const observe = (request: Request) => { requests.add(request); };
  page.on('request', observe);
  try {
    const reads = [
      { method: 'POST', path: /^\/v3\/pay_action\/batch\/price$/, operation: 'renewal-price' },
      { method: 'PUT', path: /^\/v10\/wallet\/[^/]+$/, operation: 'renewal-wallet' },
    ].map(async ({ method, path, operation }) => {
      const response = await page.waitForResponse(response => requests.has(response.request()) && response.request().method() === method
        && path.test(new URL(response.url()).pathname), { timeout: 15_000 })
        .catch(error => { throw new Error(requestErrorSummary(error, operation)); });
      await readRequestJson(response, operation);
    });
    // 先安装响应等待，再点击入口；不得用上一次打开留下的控件数值判断本次请求成功。
    await Promise.all([...reads, press(page, 'drawer-menu-item-renew')]);
    await page.clock.runFor(0);
  } finally { page.off('request', observe); }
}
