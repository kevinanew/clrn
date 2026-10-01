import { test, expect } from '../_shared/creation-account-fixture';
import { createSecondAccount, type SecondAccount } from '../_shared/second-account';
import { unique } from '../_shared/page';
import { clickWithBackgroundClubNotice } from '../_shared/navigation';
import { readDiamondBalance } from '../_shared/provision';

test('普通申请、邀请申请经房主审批后才成为俱乐部成员', { tag: '@creates-data' }, async ({ page, browser, newAccount }) => {
  test.setTimeout(420_000);
  const name = `E2E加入俱乐部${Date.now().toString(36)}`;
  const before = await readDiamondBalance(page, newAccount);
  let clubId: string | undefined;
  let apiOrigin: string | undefined;
  const guests: SecondAccount[] = [];
  const joined: SecondAccount[] = [];

  const members = async () => {
    const response = await page.request.get(`${apiOrigin}/v10/club/${clubId}/member`, {
      headers: { Authorization: newAccount.authorization }, timeout: 15_000,
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    await response.dispose();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.result?.members)).toBe(true);
    return body.result.members as { id: string }[];
  };

  const hasJoined = async (guest: SecondAccount) => {
    const response = await guest.page.request.get(`${apiOrigin}/v10/club?user_id=${guest.userId}`, {
      headers: { Authorization: guest.authorization }, timeout: 15_000,
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    await response.dispose();
    expect(body.ok).toBe(true);
    return body.result?.clubs?.some((club: { id: string }) => club.id === clubId) === true;
  };

  const openApplications = async () => {
    const id = 'club-profile-item-touchable-club_notification';
    for (let attempt = 0; attempt < 8 && !(await page.getByTestId(id).filter({ visible: true }).count()); attempt++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(100);
    }
    await clickWithBackgroundClubNotice(page, id, 3);
    await expect(await unique(page, 'club-notification-screen')).toBeVisible();
  };

  const approve = async (guest: SecondAccount) => {
    await openApplications();
    const application = await unique(page, `club-notification-item-${guest.userId}`);
    await expect(application.getByTestId(`agree-button-${guest.userId}`)).toHaveCount(1);
    const approving = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.startsWith('/v10/club/application/'));
    await application.getByTestId(`agree-button-${guest.userId}`).click();
    const response = await approving;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toEqual({ action: 'approve' });
    expect((await response.json()).ok).toBe(true);
    await expect(application.getByTestId('approved-text')).toBeVisible();
    joined.push(guest);
    await expect.poll(async () => (await members()).some(member => member.id === guest.userId)).toBe(true);
    await (await unique(page, 'navigation-bar-back-image')).click();
    await expect(await unique(page, 'club-home-page-screen')).toBeVisible();
  };

  try {
    await test.step('房主创建独立俱乐部，核对初始成员和费用', async () => {
      expect(before).toBeGreaterThanOrEqual(50);
      await clickWithBackgroundClubNotice(page, 'settings-tab', 3);
      await clickWithBackgroundClubNotice(page, 'create-club', 3);
      await (await unique(page, 'edit-club-profile-input-name')).fill(name);
      await (await unique(page, 'edit-club-profile-input-region')).fill('E2E测试地区');
      const creating = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/v3/pay_action/do', { timeout: 60_000 });
      const [response] = await Promise.all([creating, clickWithBackgroundClubNotice(page, 'edit-club-header-right-complete', 3)]);
      const body = await response.json();
      if (body.ok === true && /^[0-9a-f-]{36}$/.test(body.result?.id || body.result?.club_id || '')) {
        clubId = body.result.id || body.result.club_id;
        apiOrigin = new URL(response.url()).origin;
      }
      expect(response.ok()).toBeTruthy();
      expect(clubId, '创建响应应包含本次俱乐部 UUID').toBeTruthy();
      await expect(await unique(page, 'club-info-name')).toHaveText(name);
      await expect(await unique(page, 'club-info-member-count')).toHaveText('1');
      await expect.poll(() => readDiamondBalance(page, newAccount)).toBe(before - 50);
    });

    const applicant = await createSecondAccount(browser, page.viewportSize(), test.info().project.name === 'mobile');
    guests.push(applicant);
    await test.step('申请人通过真实搜索找到本次俱乐部并提交加入申请', async () => {
      await (await unique(applicant.page, 'hall-search-button')).click();
      const search = await unique(applicant.page, 'club-search-input');
      await search.fill(name);
      const searching = applicant.page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/v10/club/search'
        && new URL(response.url()).searchParams.get('keyword') === name);
      await search.press('Enter');
      const searchResponse = await searching;
      expect(searchResponse.ok()).toBeTruthy();
      expect((await searchResponse.json()).result).toContain(clubId);
      const target = applicant.page.getByTestId('club-search-item-touchable').filter({ visible: true });
      await expect(target).toHaveCount(1);
      await expect(target.getByTestId('club-search-item-name')).toHaveText(name);
      await target.click();
      await expect(await unique(applicant.page, 'club-info-name')).toHaveText(name);
      const applying = applicant.page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/v10/club/${clubId}/application`);
      await (await unique(applicant.page, 'club-application-join-button-touchable')).click();
      const response = await applying;
      expect(response.ok()).toBeTruthy();
      expect((await response.json()).ok).toBe(true);
      await expect(await unique(applicant.page, 'club-application-join-button-text')).toHaveText('已申请');
      expect((await members()).some(member => member.id === applicant.userId), '审批前不得成为成员').toBe(false);
    });
    await test.step('房主在申请列表审批，申请人成为真实成员', async () => {
      await approve(applicant);
      await expect.poll(() => hasJoined(applicant)).toBe(true);
    });

    const invitee = await createSecondAccount(browser, page.viewportSize(), test.info().project.name === 'mobile');
    guests.push(invitee);
    await test.step('邀请链接生成、解析后受邀者提交真实申请', async () => {
      const generated = await page.request.put(`${apiOrigin}/v1/share_link/generate`, {
        headers: { Authorization: newAccount.authorization }, data: { payload: { club_id: clubId } },
      });
      expect(generated.ok()).toBeTruthy();
      const generatedBody = await generated.json();
      await generated.dispose();
      expect(generatedBody.ok).toBe(true);
      const link = generatedBody.result?.share_link;
      expect(typeof link).toBe('string');
      const invitation = new URL(link);
      expect(invitation.origin, '邀请链接必须来自 staging 分享域名').toBe('https://shafayouxi.org');
      const code = invitation.pathname.match(/^\/laiwan\/([A-Za-z0-9]{7})$/)?.[1];
      expect(code, '邀请链接应包含可解析 code').toBeTruthy();
      const parsed = await invitee.page.request.get(`${apiOrigin}/v1/share_link/parse_code?code=${encodeURIComponent(code!)}`);
      expect(parsed.ok()).toBeTruthy();
      const parsedBody = await parsed.json();
      await parsed.dispose();
      expect(parsedBody.ok).toBe(true);
      expect(parsedBody.result?.action).toBe('new_club_application');
      expect(parsedBody.result?.params?.club_id).toBe(clubId);
      const applied = await invitee.page.request.post(`${apiOrigin}/v10/club/${clubId}/application`, {
        headers: { Authorization: invitee.authorization },
      });
      expect(applied.ok()).toBeTruthy();
      expect((await applied.json()).ok).toBe(true);
      await applied.dispose();
      expect((await members()).some(member => member.id === invitee.userId), '邀请申请仍须审批').toBe(false);
    });
    await test.step('房主审批受邀者，成员列表和人数体现实际加入', async () => {
      await approve(invitee);
      await expect.poll(async () => (await members()).length).toBe(3);
      await expect.poll(() => hasJoined(invitee)).toBe(true);
    });

    const rejected = await createSecondAccount(browser, page.viewportSize(), test.info().project.name === 'mobile');
    guests.push(rejected);
    await test.step('另一申请被房主拒绝后仍不是成员', async () => {
      const applied = await rejected.page.request.post(`${apiOrigin}/v10/club/${clubId}/application`, {
        headers: { Authorization: rejected.authorization },
      });
      expect(applied.ok()).toBeTruthy();
      expect((await applied.json()).ok).toBe(true);
      await applied.dispose();
      await openApplications();
      const application = await unique(page, `club-notification-item-${rejected.userId}`);
      const rejecting = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname.startsWith('/v10/club/application/'));
      await application.getByTestId(`refuse-button-${rejected.userId}`).click();
      const response = await rejecting;
      expect(response.ok()).toBeTruthy();
      expect(response.request().postDataJSON()).toEqual({ action: 'reject' });
      expect((await response.json()).ok).toBe(true);
      await expect(application.getByTestId('rejected-text')).toBeVisible();
      expect((await members()).some(member => member.id === rejected.userId)).toBe(false);
      expect(await hasJoined(rejected)).toBe(false);
    });
  } finally {
    try {
      if (clubId && apiOrigin) {
        for (const guest of joined) {
          const response = await guest.page.request.delete(`${apiOrigin}/v10/club/${clubId}/member/${guest.userId}`, {
            headers: { Authorization: guest.authorization }, timeout: 15_000,
          });
          expect(response.ok(), '仅移除本次测试加入的成员').toBeTruthy();
          expect((await response.json()).ok).toBe(true);
          await response.dispose();
        }
        if (joined.length) await expect.poll(async () => (await members()).length).toBe(1);
      }
    } finally {
      for (const guest of guests) await guest.context.close();
    }
  }
});
