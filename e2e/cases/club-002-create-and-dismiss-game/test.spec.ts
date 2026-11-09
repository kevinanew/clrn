import { clubIdentifier, readCreatedRoom, expectCreatedRoom } from '../_shared/created-resource';
import { test, expect } from '../_shared/creation-account-fixture';
import { unique } from '../_shared/page';
import { clickWithBackgroundClubNotice } from '../_shared/navigation';
import { readDiamondBalance } from '../_shared/provision';

test('真实创建俱乐部德州牌局、验证归属并通过API清理退款', { tag: '@creates-data' }, /** 验证真实创建俱乐部德州牌局、验证归属并通过API清理退款。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, newAccount }) => {
  const suffix = Date.now().toString(36);
  const clubName = `E2E牌局${suffix}`;
  const roomName = `E2E德州${suffix}`;
  const before = await readDiamondBalance(page, newAccount);
  let clubId: string;
  let createdRoomId: string | undefined;
  let cleanupUrl: string | undefined;

  await test.step('创建本用例自己的俱乐部，避免依赖其他测试顺序', /** 执行创建本用例自己的俱乐部，避免依赖其他测试顺序。 */ async () => {
    expect(before, '俱乐部50钻和牌局10钻，共需60钻staging测试资产').toBeGreaterThanOrEqual(60);
    await clickWithBackgroundClubNotice(page, 'settings-tab', 3);
    await clickWithBackgroundClubNotice(page, 'create-club', 3);
    await (await unique(page, 'edit-club-profile-input-name')).fill(clubName);
    await (await unique(page, 'edit-club-profile-input-region')).fill('E2E测试地区');
    const creatingClub = page.waitForResponse(/** 匹配POST `/v3/pay_action/do` 的响应，避免捕获其他请求。
 * @param response - 当前收到的接口响应。 */ response =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
    const [response] = await Promise.all([
      creatingClub, clickWithBackgroundClubNotice(page, 'edit-club-header-right-complete', 3),
    ]);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBe(true);
    clubId = clubIdentifier(body);
    expect(clubId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(await unique(page, 'club-info-name')).toHaveText(clubName);
    await expect.poll(/** 轮询创建俱乐部后的钻石余额，核对创建费用。 */ () => readDiamondBalance(page, newAccount)).toBe(before - 50);
  });

  await test.step('从俱乐部详情选择德州，确认默认10钻创建配置', /** 执行从俱乐部详情选择德州，确认默认10钻创建配置。 */ async () => {
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
    await test.step('真实创建，验证服务端俱乐部归属、牌桌名称、等待开始及扣钻', /** 执行真实创建，验证服务端俱乐部归属、牌桌名称、等待开始及扣钻。 */ async () => {
      const creating = page.waitForResponse(/** 匹配POST `/v3/pay_action/do` 的响应，避免捕获其他请求。
 * @param response - 当前收到的接口响应。 */ response =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
      const [response] = await Promise.all([creating, clickWithBackgroundClubNotice(page, 'creat-room-button', 3)]);
      const body = await readCreatedRoom(response, /** 保存本次房间用于后续精确清理。
       * @param room - 本次成功创建的房间。 */ room => {
        createdRoomId = room.id;
        cleanupUrl = room.cleanupUrl;
      });
      expectCreatedRoom(response, body, createdRoomId);
      expect(body.result.building_type).toBe('club');
      expect(body.result.building_id).toBe(clubId);
      expect(body.result.creator_id).toBe(newAccount.userId);
      expect(body.result.room_name).toBe(roomName);
      await expect(await unique(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
      await expect(await unique(page, 'texas-holdem-room-name-text')).toHaveText(roomName);
      await expect(await unique(page, 'texas-holdem-room-type-text')).toHaveText(clubName);
      await expect(await unique(page, 'countdown-text')).toHaveText('等待开始');
      await expect.poll(/** 轮询创建牌局后的钻石余额，核对牌局费用。 */ () => readDiamondBalance(page, newAccount)).toBe(before - 60);
    });
  } finally {
    if (createdRoomId && cleanupUrl) {
      const roomCleanupUrl = cleanupUrl;
      await test.step('通过API只清理本次精确UUID的未开始牌局，验证10钻退款', /** 执行通过API只清理本次精确UUID的未开始牌局，验证10钻退款。 */ async () => {
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
        await expect.poll(/** 轮询解散牌局后的钻石余额，核对最终余额。 */ () => readDiamondBalance(page, newAccount)).toBe(before - 50);
      });
    }
  }
});
