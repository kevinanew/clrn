import { test, expect } from '../_shared/creation-account-fixture';
import { createSecondAccount, type SecondAccount } from '../_shared/second-account';
import { clickWithBackgroundClubNotice } from '../_shared/navigation';
import { unique } from '../_shared/page';
import { readDiamondBalance } from '../_shared/provision';

type ClubMember = { id: string };
type Application = {
  application_id: string;
  club_id: string;
  user_id: string;
  permitted: boolean | null;
};

test('CLUB-004：房主连续移除成员后人数与列表一致', { tag: '@creates-data' }, async ({ page, browser, newAccount }) => {
  test.setTimeout(360_000);
  const name = `E2E成员管理${Date.now().toString(36)}`;
  const guests: SecondAccount[] = [];
  const memberIdsToClean = new Set<string>();
  let clubId = '';
  let apiOrigin = '';

  const members = async (): Promise<ClubMember[]> => {
    const response = await page.request.get(`${apiOrigin}/v10/club/${clubId}/member`, {
      headers: { Authorization: newAccount.authorization }, timeout: 15_000,
    });
    expect(response.ok(), '读取本例俱乐部成员应成功').toBe(true);
    const body = await response.json();
    await response.dispose();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.result?.members)).toBe(true);
    return body.result.members as ClubMember[];
  };

  const addMember = async (guest: SecondAccount) => {
    const application = await guest.page.request.post(`${apiOrigin}/v10/club/${clubId}/application`, {
      headers: { Authorization: guest.authorization }, timeout: 15_000,
    });
    expect(application.ok(), '专用账号应能申请本例俱乐部').toBe(true);
    expect((await application.json()).ok).toBe(true);
    await application.dispose();
    const listed = await page.request.get(`${apiOrigin}/v10/club/application`, {
      headers: { Authorization: newAccount.authorization }, timeout: 15_000,
    });
    expect(listed.ok(), '房主应能读取待审批申请').toBe(true);
    const body = await listed.json();
    await listed.dispose();
    expect(body.ok).toBe(true);
    const pending = (body.result?.applications as Application[]).find(item =>
      item.club_id === clubId && item.user_id === guest.userId && item.permitted === null);
    expect(pending?.application_id, '本例申请应处于待审批状态').toBeTruthy();
    memberIdsToClean.add(guest.userId);
    const approved = await page.request.post(`${apiOrigin}/v10/club/application/${pending!.application_id}`, {
      headers: { Authorization: newAccount.authorization }, data: { action: 'approve' }, timeout: 15_000,
    });
    expect(approved.ok(), '房主审批应成功').toBe(true);
    expect((await approved.json()).ok).toBe(true);
    await approved.dispose();
    await expect.poll(async () => (await members()).some(member => member.id === guest.userId)).toBe(true);
  };

  const removeMember = async (guest: SecondAccount, expectedCount: number) => {
    await (await unique(page, 'club-member-edit-button')).click();
    const editMode = await unique(page, 'club-member-edit-mode');
    await expect(editMode).toBeVisible();
    const item = editMode.getByTestId(`club-member-item-${guest.userId}`);
    await expect(item).toHaveCount(1);
    await item.click();
    await expect(editMode.getByTestId(`club-member-remove-selected-${guest.userId}`)).toBeVisible();
    await (await unique(page, 'club-member-remove-mode-button')).click();
    await expect(await unique(page, 'club-member-remove-confirm-dialog')).toBeVisible();
    const deleting = page.waitForResponse(response => response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/v10/club/${clubId}/member/${guest.userId}`);
    await (await unique(page, 'club-member-remove-confirm-button')).click();
    const response = await deleting;
    expect(response.ok(), '移除成员请求应成功').toBe(true);
    expect((await response.json()).ok, '移除成员业务响应应成功').toBe(true);
    memberIdsToClean.delete(guest.userId);
    const normalMode = await unique(page, 'club-member-normal-mode');
    await expect(normalMode).toHaveAttribute('data-member-count', String(expectedCount));
    await expect(normalMode.getByTestId(`club-member-item-${guest.userId}`)).toHaveCount(0);
    await expect.poll(async () => (await members()).some(member => member.id === guest.userId)).toBe(false);
  };

  try {
    await test.step('创建本例专用俱乐部并核对真实扣费', async () => {
      const before = await readDiamondBalance(page, newAccount);
      expect(before).toBeGreaterThanOrEqual(50);
      await clickWithBackgroundClubNotice(page, 'settings-tab', 3);
      await clickWithBackgroundClubNotice(page, 'create-club', 3);
      await (await unique(page, 'edit-club-profile-input-name')).fill(name);
      await (await unique(page, 'edit-club-profile-input-region')).fill('E2E测试地区');
      const creating = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
      const [response] = await Promise.all([creating, clickWithBackgroundClubNotice(page, 'edit-club-header-right-complete', 3)]);
      const body = await response.json();
      expect(response.ok()).toBe(true);
      expect(body.ok).toBe(true);
      clubId = body.result?.id || body.result?.club_id || '';
      expect(clubId, '创建响应应包含本例俱乐部 UUID').toMatch(/^[0-9a-f-]{36}$/);
      apiOrigin = new URL(response.url()).origin;
      await expect(await unique(page, 'club-info-name')).toHaveText(name);
      await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 50);
      await expect.poll(async () => (await members()).length).toBe(1);
    });

    await test.step('两个独立账号经真实申请和审批成为成员', async () => {
      for (let index = 0; index < 2; index++) {
        const guest = await createSecondAccount(browser, page.viewportSize(), test.info().project.name === 'mobile');
        guests.push(guest);
        await addMember(guest);
      }
      await expect.poll(async () => (await members()).length).toBe(3);
    });

    await test.step('连续删除与中途取消编辑后，页面和服务端人数一致', async () => {
      await clickWithBackgroundClubNotice(page, 'club-profile-item-touchable-member_management', 3);
      const normalMode = await unique(page, 'club-member-normal-mode');
      await expect(normalMode).toHaveAttribute('data-is-refreshing', 'false');
      await expect(normalMode).toHaveAttribute('data-member-count', '3');
      for (const guest of guests) {
        await expect(normalMode.getByTestId(`club-member-item-${guest.userId}`)).toBeVisible();
      }

      await removeMember(guests[0], 2);
      await (await unique(page, 'club-member-edit-button')).click();
      const editMode = await unique(page, 'club-member-edit-mode');
      await editMode.getByTestId(`club-member-item-${guests[1].userId}`).click();
      await expect(editMode.getByTestId(`club-member-remove-selected-${guests[1].userId}`)).toBeVisible();
      await (await unique(page, 'club-member-cancel-button')).click();
      await expect(normalMode).toHaveAttribute('data-member-count', '2');
      await expect(normalMode.getByTestId(`club-member-item-${guests[1].userId}`)).toBeVisible();
      await expect.poll(async () => (await members()).some(member => member.id === guests[1].userId)).toBe(true);

      await removeMember(guests[1], 1);
      expect((await members()).map(member => member.id)).toEqual([newAccount.userId]);
    });
  } finally {
    try {
      if (clubId && apiOrigin) {
        await Promise.allSettled(guests.filter(guest => memberIdsToClean.has(guest.userId)).map(async guest => {
          const response = await guest.page.request.delete(`${apiOrigin}/v10/club/${clubId}/member/${guest.userId}`, {
            headers: { Authorization: guest.authorization }, timeout: 15_000,
          });
          await response.dispose();
        }));
        await expect.poll(async () => (await members()).length, { timeout: 20_000 }).toBe(1);
      }
    } finally {
      for (const guest of guests) await guest.context.close();
    }
  }
});
