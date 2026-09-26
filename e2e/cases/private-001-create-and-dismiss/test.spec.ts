import { test, expect } from '../_shared/creation-account-fixture';
import { unique } from '../_shared/page';
import { clickWithBackgroundClubNotice } from '../_shared/navigation';
import { readDiamondBalance } from '../_shared/provision';

test('私人德州牌局真实创建、退出、解散并退回钻石', async ({ page, newAccount }) => {
  let createdRoomId: string | undefined;
  let cleanupUrl: string | undefined;
  let removed = false;
  let roomTestId: string | null = null;
  const name = `E2E私局${Date.now().toString(36)}`;
  const before = await readDiamondBalance(page, newAccount);

  await test.step('进入空私人房间，检查创建配置和实际资产', async () => {
    expect(before, '测试账号至少需要10钻；不足应补充staging测试资产').toBeGreaterThanOrEqual(10);
    await clickWithBackgroundClubNotice(page, 'private-room-tab', 3);
    await expect(await unique(page, 'copy-house-number-button')).toHaveText(/房间号:\s*\d{9}/);
    await clickWithBackgroundClubNotice(page, 'create-game-button', 3);
    await clickWithBackgroundClubNotice(page, 'game-type-button-texas_react_native', 3);
    await expect(await unique(page, 'base-create-room-screen')).toBeVisible();
    await (await unique(page, 'room-name-input')).fill(name);
    await expect(await unique(page, 'price-text')).toHaveText('10');
    await expect(await unique(page, 'chip-item-text')).toHaveText('记分牌');
  });

  try {
    await test.step('提交真实创建，验证桌名、房型、等待开始及扣钻', async () => {
      const creating = page.waitForResponse(response =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/v3/pay_action/do');
      const [response] = await Promise.all([creating, clickWithBackgroundClubNotice(page, 'creat-room-button', 3)]);
      const body = await response.json();
      // 在任何页面断言前记录真实创建响应的UUID，UI导航失败也能精确回收。
      if (body.ok === true && /^[0-9a-f-]{36}$/.test(body.result?.room_id || '')) {
        createdRoomId = body.result.room_id;
        cleanupUrl = `${new URL(response.url()).origin}/v1/room/${createdRoomId}`;
      }
      expect(response.ok()).toBeTruthy();
      expect(body.ok).toBe(true);
      expect(createdRoomId, '创建成功应返回真实room_id').toBeTruthy();
      await expect(await unique(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
      await expect(await unique(page, 'texas-holdem-room-name-text')).toHaveText(name);
      await expect(await unique(page, 'texas-holdem-room-type-text')).toHaveText('私人房间');
      await expect(await unique(page, 'countdown-text')).toHaveText('等待开始');
      await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 10);
    });
    await test.step('退出桌面，验证刚创建牌局仍在私人房间', async () => {
      await clickWithBackgroundClubNotice(page, 'menu-button', 3);
      await clickWithBackgroundClubNotice(page, 'drawer-menu-item-exit', 3);
      const room = page.getByTestId(/^private-room-[0-9a-f-]{36}$/).filter({ visible: true });
      await expect(room).toHaveCount(1);
      roomTestId = await room.getAttribute('data-testid');
      await expect(room.getByTestId('personal-house-timer')).toHaveText('等待开始');
    });
  } finally {
    if (createdRoomId && cleanupUrl) {
      try {
        await test.step('清理本次未开始牌局，验证真实解散接口和退款', async () => {
          if (await page.getByTestId('run-game-view').isVisible()) {
            await clickWithBackgroundClubNotice(page, 'menu-button', 3);
            await clickWithBackgroundClubNotice(page, 'drawer-menu-item-exit', 3);
          }
          await expect(page.getByTestId(`private-room-${createdRoomId}`).filter({ visible: true })).toHaveCount(1);
          await clickWithBackgroundClubNotice(page, 'close-room-button', 3);
          const popup = await unique(page, 'private-room-confirm-popup');
          await expect(popup).toContainText('您确定要解散当前牌局吗');
          const closed = page.waitForResponse(response =>
            response.request().method() === 'DELETE'
            && new URL(response.url()).pathname === `/v1/room/${createdRoomId}`);
          await clickWithBackgroundClubNotice(page, 'confirm-button', 3);
          const response = await closed;
          expect(response.ok()).toBeTruthy();
          expect((await response.json()).ok).toBe(true);
          removed = true;
          await expect(await unique(page, 'create-game-button')).toBeVisible();
          if (roomTestId) await expect(page.getByTestId(roomTestId)).toHaveCount(0);
          await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before);
        });
      } finally {
        if (!removed) {
          // 只允许删除本次成功响应捕获的牌局；UI失败仍保持测试失败。
          let response;
          try {
            response = await page.request.delete(cleanupUrl, {
              headers: { Authorization: newAccount.authorization }, timeout: 15_000,
            });
          } catch {
            throw new Error(`本次牌局 ${createdRoomId} 的API兜底清理请求失败`);
          }
          expect(response.ok(), '本次牌局兜底清理HTTP应成功').toBeTruthy();
          expect((await response.json()).ok, '本次牌局兜底清理业务应成功').toBe(true);
          await response.dispose();
        }
      }
    }
  }
});
