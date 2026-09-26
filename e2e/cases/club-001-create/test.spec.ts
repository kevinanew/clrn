import { test, expect } from '../_shared/creation-account-fixture';
import { unique } from '../_shared/page';
import { clickWithBackgroundClubNotice } from '../_shared/navigation';
import { readDiamondBalance } from '../_shared/provision';

test('真实创建俱乐部并核实详情、归属和服务端持久化', async ({ page, newAccount }) => {
  const name = `E2E俱乐部${Date.now().toString(36)}`;
  const region = 'E2E测试地区';
  const before = await readDiamondBalance(page, newAccount);
  let profileUrl: string;
  let createdClubId: string;

  await test.step('进入创建表单，验证必填校验与50钻费用', async () => {
    expect(before, '创建俱乐部至少需要50钻').toBeGreaterThanOrEqual(50);
    await clickWithBackgroundClubNotice(page, 'settings-tab', 3);
    await clickWithBackgroundClubNotice(page, 'create-club', 3);
    await expect(await unique(page, 'club-profile-list')).toContainText('需要消耗50钻石');
    await expect(await unique(page, 'edit-club-header-right-complete')).toHaveAttribute('aria-disabled', 'true');
    await (await unique(page, 'edit-club-profile-input-name')).fill(name);
    await expect(await unique(page, 'edit-club-header-right-complete')).toHaveAttribute('aria-disabled', 'true');
    await (await unique(page, 'edit-club-profile-input-region')).fill(region);
    await expect(await unique(page, 'edit-club-header-right-complete')).not.toHaveAttribute('aria-disabled', 'true');
  });

  await test.step('提交真实创建，验证详情与50钻扣除', async () => {
    const creatingClub = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/v3/pay_action/do');
    const [clubResponse] = await Promise.all([creatingClub, clickWithBackgroundClubNotice(page, 'edit-club-header-right-complete', 3)]);
    expect(clubResponse.ok()).toBeTruthy();
    const body = await clubResponse.json();
    expect(body.ok).toBe(true);
    createdClubId = body.result?.id || body.result?.club_id;
    expect(createdClubId, '创建响应必须返回真实俱乐部UUID').toMatch(/^[0-9a-f-]{36}$/);
    expect(body.result.name).toBe(name);
    expect(body.result.area).toBe(region);
    profileUrl = `${new URL(clubResponse.url()).origin}/v10/club/${createdClubId}/profile`;
    await expect(await unique(page, 'club-home-page-screen')).toBeVisible({ timeout: 60_000 });
    await expect(await unique(page, 'club-info-name')).toHaveText(name);
    await expect(await unique(page, 'club-info-region-text')).toHaveText(region);
    await expect(await unique(page, 'club-info-member-count')).toHaveText('1');
    await expect(await unique(page, 'club-profile-item-content-club_id')).toHaveText(/^\d{9}$/);
    await expect(await unique(page, 'club-rooms-empty-card')).toBeVisible();
    await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 50);
  });

  await test.step('独立读取刚创建的俱乐部，验证服务端持久化与创建人归属', async () => {
    let response;
    try {
      response = await page.request.get(profileUrl, {
        headers: { Authorization: newAccount.authorization }, timeout: 15_000,
      });
    } catch {
      throw new Error('读取本次创建俱乐部详情请求失败');
    }
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    await response.dispose();
    expect(body.ok).toBe(true);
    expect(body.result.club_id).toBe(createdClubId);
    expect(body.result.name).toBe(name);
    expect(body.result.area).toBe(region);
    expect(body.result.owner_id).toBe(newAccount.userId);
    expect(body.result.member_count).toBe(1);
    await expect(await unique(page, 'club-profile-item-content-club_id')).toHaveText(String(body.result.club_no));
  });
});
