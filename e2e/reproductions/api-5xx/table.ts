/** 从真实入口创建本轮私人牌桌，失败时也只清理本轮确切房间。 */
import { expect, type Page } from '@playwright/test';
import type { Session } from '../../cases/_shared/auth';
import { clickWithBackgroundClubNotice } from '../../cases/_shared/navigation';

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
    if (roomId) {
      const response = await page.request.delete(`https://api.shafayouxi.org/v1/room/${roomId}`, {
        headers: { Authorization: account.authorization }, timeout: 15_000,
      });
      try {
        expect(response.ok(), '本轮房间必须清理成功').toBe(true);
        expect((await response.json()).ok).toBe(true);
      } finally { await response.dispose(); }
    }
  }
}
