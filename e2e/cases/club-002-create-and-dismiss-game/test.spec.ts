import { test, expect } from '../_shared/creation-account-fixture';
import { unique } from '../_shared/page';
import { clickWithBackgroundClubNotice } from '../_shared/navigation';
import { readDiamondBalance } from '../_shared/provision';

test('真实创建俱乐部德州牌局、验证归属并通过API清理退款', async ({ page, newAccount }) => {
  const suffix = Date.now().toString(36);
  const clubName = `E2E牌局${suffix}`;
  const roomName = `E2E德州${suffix}`;
  const before = await readDiamondBalance(page, newAccount);
  let clubId: string;
  let createdRoomId: string | undefined;
  let cleanupUrl: string | undefined;

  await test.step('创建本用例自己的俱乐部，避免依赖其他测试顺序', async () => {
    expect(before, '俱乐部50钻和牌局10钻，共需60钻staging测试资产').toBeGreaterThanOrEqual(60);
    await clickWithBackgroundClubNotice(page, 'settings-tab', 3);
    await clickWithBackgroundClubNotice(page, 'create-club', 3);
    await (await unique(page, 'edit-club-profile-input-name')).fill(clubName);
    await (await unique(page, 'edit-club-profile-input-region')).fill('E2E测试地区');
    const creatingClub = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
    const [response] = await Promise.all([
      creatingClub, clickWithBackgroundClubNotice(page, 'edit-club-header-right-complete', 3),
    ]);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBe(true);
    clubId = body.result?.id || body.result?.club_id;
    expect(clubId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(await unique(page, 'club-info-name')).toHaveText(clubName);
    await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 50);
  });

  await test.step('从俱乐部详情选择德州，确认默认10钻创建配置', async () => {
    await clickWithBackgroundClubNotice(page, 'club-profile-item-touchable-create_game', 3);
    await clickWithBackgroundClubNotice(page, 'game-type-button-texas_react_native', 3);
    await expect(await unique(page, 'base-create-room-screen')).toBeVisible();
    const roomInput = await unique(page, 'room-name-input');
    await roomInput.fill(roomName);
    await expect(roomInput).toHaveValue(roomName);
    await expect(await unique(page, 'price-text')).toHaveText('10');
    await expect(await unique(page, 'chip-item-text')).toHaveText('记分牌');
  });

  try {
    await test.step('真实创建，验证服务端俱乐部归属、牌桌名称、等待开始及扣钻', async () => {
      const creating = page.waitForResponse(response =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
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
      expect(body.result.building_type).toBe('club');
      expect(body.result.building_id).toBe(clubId);
      expect(body.result.creator_id).toBe(newAccount.userId);
      expect(body.result.room_name).toBe(roomName);
      await expect(await unique(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
      await expect(await unique(page, 'texas-holdem-room-name-text')).toHaveText(roomName);
      await expect(await unique(page, 'texas-holdem-room-type-text')).toHaveText(clubName);
      await expect(await unique(page, 'countdown-text')).toHaveText('等待开始');
      await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 60);
    });
  } finally {
    if (createdRoomId && cleanupUrl) {
      const roomCleanupUrl = cleanupUrl;
      await test.step('通过API只清理本次精确UUID的未开始牌局，验证10钻退款', async () => {
        let response;
        try {
          response = await page.request.delete(roomCleanupUrl, {
            headers: { Authorization: newAccount.authorization }, timeout: 15_000,
          });
        } catch {
          throw new Error(`本次牌局 ${createdRoomId} 的API清理请求失败`);
        }
        expect(response.ok(), '本次牌局清理HTTP应成功').toBeTruthy();
        expect((await response.json()).ok, '本次牌局清理业务应成功').toBe(true);
        await response.dispose();
        await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 50);
      });
    }
  }
});
