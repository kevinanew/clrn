/** 真实页面带入操作及正确行为断言，不替换网络响应或应用状态。 */
import { expect, type Page, type Response } from '@playwright/test';

/**
 * 查找当前可见的真实错误提示。
 * @param page - 当前牌桌页面。
 */
export function errorNotice(page: Page) {
  return page.getByTestId('toastText1').or(page.getByTestId('common-alert-message'))
    .or(page.getByTestId('alert-message-text')).filter({ visible: true }).first();
}

/**
 * 错误必须去空白后非空，且不能把服务器错误误报为余额或筹码不足。
 * @param message - 保留原样的实际页面提示，未出现时为 null。
 */
export function expectReadableError(message: string | null): void {
  expect.soft(message?.trim() || '', '5xx 应显示非空、可读的错误').not.toBe('');
  expect.soft(message || '', '不得显示 undefined 或将 5xx 误报为余额不足')
    .not.toMatch(/undefined|筹码不足|余额不足|籌碼不足|餘額不足|insufficient\s+(?:chips|balance|funds)/i);
}

/**
 * 从可见座位提交带入，并等待本次操作产生的真实目标响应。
 * @param page - 当前真实牌桌。
 * @param target - 本轮准确房间的带入接口路径。
 */
export async function submitBuyIn(page: Page, target: string): Promise<Response> {
  const dismiss = page.getByTestId('common-alert-button-undefined').filter({ visible: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await expect(errorNotice(page), '再次操作前上一条错误应通过原按钮或自然消退结束').toBeHidden();
  await page.getByTestId('in-game-container-seat').first().click();
  await expect(page.getByTestId('buy-in-confirm-button')).toBeVisible({ timeout: 30_000 });
  const [response] = await Promise.all([
    page.waitForResponse(/** 只接收本次准确接口的 POST 响应。
     * @param received - 浏览器收到的真实响应。 */ received => new URL(received.url()).pathname === target
      && received.request().method() === 'POST'),
    page.getByTestId('buy-in-confirm-button').click(),
  ]);
  return response;
}

/**
 * 成功必须实际入座 100 筹码，并结束带入和错误状态。
 * @param page - 正常对照或故障解除后的真实牌桌。
 */
export async function expectSeated(page: Page): Promise<void> {
  await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('text-holdem-own-balance-text')).toHaveText('100');
  await expect(page.getByTestId('texas-holdem-buy-in-popup-visible-marker')).toHaveCount(0);
  await expect(errorNotice(page)).toBeHidden();
}

/**
 * 对照、故障、恢复及清理期间的未处理页面异常必须使场景失败，不输出原始异常内容。
 * @param page - 产生 pageerror 事件的真实页面。
 * @param task - 完整实验；可在开始故障前调用检查，避免正常对照的异常被延后处理。
 */
export async function withNoPageErrors(page: Pick<Page, 'on' | 'off'>,
  task: (check: () => void) => Promise<void>): Promise<void> {
  let count = 0;
  /** 只统计未处理异常，不把潜在敏感消息或堆栈写入报告。 */
  const observe = () => { count++; };
  /** 正常对照中已经出现的未处理异常必须阻止后续注入。 */
  const check = () => { expect(count, '正常对照不得出现未处理页面异常').toBe(0); };
  page.on('pageerror', observe);
  try { await task(check); }
  finally {
    page.off('pageerror', observe);
    expect.soft(count, '对照、5xx 和恢复期间不得出现未处理页面异常').toBe(0);
  }
}
