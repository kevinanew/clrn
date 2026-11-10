import { type Page, type Request, type Response } from '@playwright/test';
import { readRequestJson } from '../src/support/requestJson';
import { requestFailure } from '../src/support/requestError';
import { press } from './appSession';
import { settleAnimations } from './timeline';

/** 已确认传输中断的续时读取，允许通过真实入口恢复一次。 */
class InterruptedRenewRead extends Error {}

/**
 * 打开续时面板并等待本次真实读取，避免关闭后遗留请求的错误污染下一轮采样。
 * @param page - 虚拟时钟已暂停的牌桌页面。
 */
export async function openRenewPopup(page: Page): Promise<void> {
  try { await readRenewPopup(page); }
  catch (error) {
    if (!(error instanceof InterruptedRenewRead)) throw error;
    // 只恢复一次已确认中断的只读请求；HTTP、业务及解析错误仍立即失败。
    console.log('ANIMATION > renewal read interrupted; reopening once');
    await page.clock.runFor(0);
    await dismissRenewAlert(page);
    await settleAnimations(page, 1600, true);
    await press(page, 'renew-popup-close-button');
    await settleAnimations(page, 1600, true);
    await press(page, 'menu-button');
    await settleAnimations(page, 1200, true);
    await readRenewPopup(page);
  }
}

/**
 * 等待一次打开的全部读取结束，恢复前不能留下旧的响应等待器。
 * @param page - 虚拟时钟已暂停的牌桌页面。
 */
async function readRenewPopup(page: Page): Promise<void> {
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
    ].map(/** 等待指定的续时读取并校验 JSON 正文。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ method, path, operation }) => {
      const response = await waitForRead(page, requests, method, path, operation);
      await readRequestJson(response, operation);
    });
    // 先安装响应等待，再点击入口；不得用上一次打开留下的控件数值判断本次请求成功。
    const results = await Promise.allSettled([...reads, press(page, 'drawer-menu-item-renew')]);
    const failures = results.filter(/** 提取失败的牌面加载结果，供就绪失败诊断报告。
 * @param result - 当前操作使用的 result。 */ result => result.status === 'rejected');
    // 同时出现业务拒绝与网络中断时，不能用恢复逻辑掩盖业务拒绝。
    const failure = failures.find(/** 查找非预期中断错误，优先报告真正导致续时就绪失败的原因。
 * @param result - 当前操作使用的 result。 */ result => !(result.reason instanceof InterruptedRenewRead)) || failures[0];
    if (failure) throw failure.reason;
    await page.clock.runFor(0);
  } finally { page.off('request', observe); }
}

/**
 * 在本次读取期限内等待应用切换节点；无成功响应才恢复入口，并移除监听器。
 * @param page - 当前牌桌页面。
 * @param requests - 本次打开期间发出的请求。
 * @param method - 读取方法。
 * @param path - 读取路径。
 * @param operation - 固定诊断操作。
 */
function waitForRead(page: Page, requests: Set<Request>, method: string, path: RegExp,
  operation: string): Promise<Response> {
  return new Promise(/** 监听本次续时请求的响应与中断，在截止时间内提供正确结果。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
    let interrupted = false;
    /**
     * 只匹配本次打开的真实读取。
     * @param request - 浏览器发出的请求。
     */
    const matches = (request: Request) => requests.has(request) && request.method() === method
      && path.test(new URL(request.url()).pathname);
    /** 移除成功、失败及超时监听。 */
    const cleanup = () => {
      clearTimeout(timeout);
      page.off('response', responded);
      page.off('requestfailed', failed);
    };
    /**
     * 接收真实响应，HTTP 与业务校验由调用方完成。
     * @param response - 浏览器收到的响应。
     */
    const responded = (response: Response) => {
      if (!matches(response.request())) return;
      cleanup();
      resolve(response);
    };
    /**
     * 只对已确认的传输中断允许恢复。
     * @param request - 浏览器报告失败的请求。
     */
    const failed = (request: Request) => {
      if (!matches(request)) return;
      // 应用可能已在另一个节点重发同一读取，旧节点失败不能抢先终止等待。
      interrupted = true;
    };
    const timeout = setTimeout(/** 清理监听并区分读取中断和超时，拒绝未完成的续时等待。 */ () => {
      cleanup();
      reject(interrupted
        ? new InterruptedRenewRead(requestFailure(operation, 'connection-failed').message)
        : requestFailure(operation, 'timeout'));
    }, 15_000);
    page.on('response', responded);
    page.on('requestfailed', failed);
  });
}

/**
 * 恢复真实入口前关闭已出现的提示，缺失时继续原恢复流程。
 * @param page - 续时页面。
 */
async function dismissRenewAlert(page: Page): Promise<void> {
  if (await page.getByTestId('alert-ok-button').isVisible()) await press(page, 'alert-ok-button');
}
