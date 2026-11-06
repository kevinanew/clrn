/** 从真实入口创建本轮私人牌桌，失败时也只清理本轮确切房间。 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Session } from '../../cases/_shared/auth';
import { clickWithBackgroundClubNotice } from '../../cases/_shared/navigation';
import { requestFailure, requestFailureReason } from '../../../scripts/request-failure.cjs';

/**
 * 清理准确房间；请求、正文和释放失败只传播固定诊断，不保留认证头或原始 cause。
 * @param request - 本轮页面的请求上下文。
 * @param authorization - 只用于请求的会话认证。
 * @param roomId - 本轮创建响应返回的准确房间。
 */
export async function deleteTable(request: Pick<APIRequestContext, 'delete'>,
  authorization: string, roomId: string): Promise<void> {
  const response = await request.delete(`https://api.shafayouxi.org/v1/room/${roomId}`, {
    headers: { Authorization: authorization }, timeout: 15_000,
  }).catch(/** 将可能包含完整认证头的 Playwright 传输异常转换为安全诊断。
   * @param error - 请求边界捕获的原始异常。 */ error => {
    throw requestFailure('room-delete', requestFailureReason(error));
  });
  const status = response.status();
  try {
    if (!response.ok()) throw requestFailure('room-delete', 'http-error', status);
    const body = await response.json().catch(/** 正文读取或解析失败不输出原始内容。 */ () => {
      throw requestFailure('room-delete', 'body-read-failed', status);
    });
    if (body?.ok !== true) throw requestFailure('room-delete', 'business-rejected', status);
  } finally {
    await response.dispose().catch(/** 响应释放失败同样保持失败并移除底层诊断。 */ () => {
      throw requestFailure('room-delete', 'body-read-failed', status);
    });
  }
}

/**
 * 通过页面建房并关闭带入审核，保证测试会发出真实带入请求。
 * @param page - 已正常初始化和登录的页面。
 * @param account - 当前独占账号。
 * @param task - 使用本轮房间执行的操作。
 */
export async function withTable(page: Page, account: Session,
  task: (roomId: string) => Promise<void>): Promise<void> {
  let roomId: string | undefined;
  try {
    for (const id of ['private-room-tab', 'create-game-button', 'game-type-button-texas_react_native']) {
      await clickWithBackgroundClubNotice(page, id, 3);
    }
    await page.getByTestId('room-name-input').filter({ visible: true }).fill(`E2E私局${Date.now()}`);
    await page.getByTestId('audit-buy-in-switch').getByRole('switch').uncheck();
    const creating = page.waitForResponse(/** 只接收本次真实建房支付响应。
     * @param response - 浏览器收到的响应。 */ response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/v3/pay_action/do');
    await clickWithBackgroundClubNotice(page, 'creat-room-button', 3);
    const response = await creating;
    const body = await response.json();
    if (body.ok === true && /^[0-9a-f-]{36}$/.test(body.result?.room_id || '')) roomId = body.result.room_id;
    expect(response.ok()).toBe(true);
    expect(roomId, '必须取得本次创建响应中的准确房间').toBeTruthy();
    await expect(page.getByTestId('run-game-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('texas-holdem-room-type-text')).toHaveText('私人房间', { timeout: 30_000 });
    await task(roomId!);
  } finally {
    if (roomId) await deleteTable(page.request, account.authorization, roomId);
  }
}
