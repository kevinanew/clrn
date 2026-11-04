/** 本轮独占账号通过正常页面创建私人桌，并只回收本次创建响应返回的房间。 */
import { expect, type Page } from '@playwright/test';
import type { Session } from '../../cases/_shared/auth';
import { clickWithBackgroundClubNotice } from '../../cases/_shared/navigation';
import { unique } from '../../cases/_shared/page';
import { readDiamondBalance } from '../../cases/_shared/provision';
import { requestFailure, requestFailureReason } from '../../../scripts/request-failure.cjs';

/**
 * 通过真实创建流程取得准确房间编号；失败时仍保留编号以供回收。
 * @param page - 已真实登录的页面。
 * @param account - 当前独占账号会话。
 * @param task - 在本轮未开始牌局中执行的操作。
 */
export async function withPrivateTable(page: Page, account: Session,
  task: (roomId: string) => Promise<void>): Promise<void> {
  let roomId: string | undefined;
  const diamonds = await readDiamondBalance(page, account);
  try {
    for (const id of ['private-room-tab', 'create-game-button', 'game-type-button-texas_react_native']) {
      await clickWithBackgroundClubNotice(page, id, 3);
    }
    await expect(page.getByTestId('room-name-input').filter({ visible: true }))
      .toBeVisible({ timeout: 30_000 });
    await (await unique(page, 'room-name-input')).fill(`E2E私局${Date.now().toString(36)}`);
    await (await unique(page, 'audit-buy-in-switch')).getByRole('switch').uncheck();
    const creating = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/v3/pay_action/do');
    await clickWithBackgroundClubNotice(page, 'creat-room-button', 3);
    const response = await creating;
    const body = await response.json();
    if (body.ok === true && /^[0-9a-f-]{36}$/.test(body.result?.room_id || '')) roomId = body.result.room_id;
    expect(response.ok()).toBe(true);
    expect(roomId, '创建应返回本次真实房间编号').toBeTruthy();
    await expect(page.getByTestId('run-game-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('texas-holdem-room-type-text')).toHaveText('私人房间', { timeout: 30_000 });
    await task(roomId!);
  } finally {
    if (roomId) {
      const response = await page.request.delete(`https://api.shafayouxi.org/v1/room/${roomId}`, {
        headers: { Authorization: account.authorization }, timeout: 15_000,
      }).catch(error => { throw requestFailure('issue94-room-cleanup', requestFailureReason(error)); });
      try {
        expect(response.ok(), '本次房间清理 HTTP 应成功').toBe(true);
        expect((await response.json()).ok, '本次房间清理业务应成功').toBe(true);
        await expect.poll(() => readDiamondBalance(page, account), {
          message: '必须等本轮解散退款实际到账后才能开始下一例，防止跨例迟到退款', timeout: 30_000,
        }).toBe(diamonds);
      } finally {
        await response.dispose();
      }
    }
  }
}
