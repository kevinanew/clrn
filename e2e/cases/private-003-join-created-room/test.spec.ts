import { test, expect } from '../_shared/creation-account-fixture';
import { createSecondAccount } from '../_shared/second-account';
import { unique } from '../_shared/page';
import { clickWithBackgroundClubNotice } from '../_shared/navigation';
import { readDiamondBalance } from '../_shared/provision';

test('第二账号通过真实房号加入新建私人牌局', { tag: '@creates-data' }, async ({ page, browser, newAccount }) => {
  test.setTimeout(240_000);
  const before = await readDiamondBalance(page, newAccount);
  const name = `E2E加入私局${Date.now().toString(36)}`;
  let roomId: string | undefined;
  let roomOrigin: string | undefined;
  let guest: Awaited<ReturnType<typeof createSecondAccount>> | undefined;

  try {
    await test.step('房主创建等待开始的私人牌局并读取其真实房号', async () => {
      expect(before).toBeGreaterThanOrEqual(10);
      await clickWithBackgroundClubNotice(page, 'private-room-tab', 3);
      await clickWithBackgroundClubNotice(page, 'create-game-button', 3);
      await clickWithBackgroundClubNotice(page, 'game-type-button-texas_react_native', 3);
      await (await unique(page, 'room-name-input')).fill(name);
      const creating = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
      const [response] = await Promise.all([creating, clickWithBackgroundClubNotice(page, 'creat-room-button', 3)]);
      const body = await response.json();
      if (body.ok === true && /^[0-9a-f-]{36}$/.test(body.result?.room_id || '')) {
        roomId = body.result.room_id;
        roomOrigin = new URL(response.url()).origin;
      }
      expect(response.ok()).toBeTruthy();
      expect(roomId, '创建响应应返回本次牌局 UUID').toBeTruthy();
      await expect(await unique(page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
      await expect(await unique(page, 'texas-holdem-room-name-text')).toHaveText(name);
      await clickWithBackgroundClubNotice(page, 'menu-button', 3);
      await clickWithBackgroundClubNotice(page, 'drawer-menu-item-exit', 3);
      await expect(page.getByTestId(`private-room-${roomId}`).filter({ visible: true })).toHaveCount(1);
      await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 10);
    });

    guest = await createSecondAccount(browser, page.viewportSize(), test.info().project.name === 'mobile');
    await test.step('加入者输入房主的九位房号，实际进入同一牌桌', async () => {
      const houseNumberText = await (await unique(page, 'copy-house-number-button')).innerText();
      const houseNumber = houseNumberText.match(/\d{9}/)?.[0];
      expect(houseNumber, '房主页面应显示九位房号').toMatch(/^\d{9}$/);
      await (await unique(guest!.page, 'private-room-tab')).click();
      await (await unique(guest!.page, 'personal-house-join')).click();
      const pin = await unique(guest!.page, 'personal-room-smooth-pin-code-input');
      const input = (await pin.evaluate(node => node.tagName === 'INPUT')) ? pin : pin.locator('input').filter({ visible: true });
      await expect(input, '房号组件应有唯一可输入元素').toHaveCount(1);
      await input.fill(houseNumber!);
      await expect(await unique(guest!.page, 'join-game-button')).toBeEnabled();
      await (await unique(guest!.page, 'join-game-button')).click();
      await expect(await unique(guest!.page, 'run-game-view')).toBeVisible({ timeout: 60_000 });
      await expect(await unique(guest!.page, 'texas-holdem-room-name-text')).toHaveText(name);
      await expect(await unique(guest!.page, 'texas-holdem-room-type-text')).toHaveText('私人房间');
      await expect(await unique(guest!.page, 'countdown-text')).toHaveText('等待开始');
      await (await unique(guest!.page, 'menu-button')).click();
      await (await unique(guest!.page, 'drawer-menu-item-exit')).click();
      await expect(await unique(guest!.page, 'house-section-list')).toBeVisible();
    });
  } finally {
    await guest?.context.close();
    if (roomId && roomOrigin) {
      const response = await page.request.delete(`${roomOrigin}/v1/room/${roomId}`, {
        headers: { Authorization: newAccount.authorization }, timeout: 15_000,
      });
      expect(response.ok(), '只删除本次创建的牌局').toBeTruthy();
      expect((await response.json()).ok).toBe(true);
      await response.dispose();
      await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before);
    }
  }
});
