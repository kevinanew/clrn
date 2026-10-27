/** 用代理固定只读俱乐部结果，验证真实输入、请求、渲染及截图证据。 */
import { test as accountTest, expect } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { type Mitmproxy } from '../../helpers/mitmproxy-client';
import { withMitmproxy } from '../../helpers/mitmproxy-session';

const keyword = 'VisualClubSearch';
const clubId = '12f2cb6e-9045-4910-b58a-7d3903f56a39';
const clubName = '搜索测试俱乐部';

const test = accountTest.extend<{ clubSearchProxy: Mitmproxy }>({
  /**
   * 每例独立启动代理，登录请求透传，搜索与资料请求返回固定结果。
   * @param root0 - 测试框架提供的空依赖集合。
   * @param use - 将代理交给本例并等待测试结束。
   */
  clubSearchProxy: async ({}, use) => {
    await withMitmproxy(async proxy => {
      await use(proxy);
    });
  },
  /**
   * 浏览器须在登录前接入代理，确保搜索请求确实经过 mitmproxy。
   * @param root0 - 本例代理依赖。
   * @param use - 将浏览器代理配置交给测试框架。
   */
  proxy: async ({ clubSearchProxy }, use) => {
    await use({ server: clubSearchProxy.server, bypass: '<-loopback>' });
  },
  ignoreHTTPSErrors: true,
});

test('俱乐部搜索命中固定结果并显示对应卡片', async ({ page, signedInAccount, clubSearchProxy }) => {
  expect(signedInAccount.userId).toBeTruthy();

  await test.step('从俱乐部菜单进入搜索页', async () => {
    await (await unique(page, 'club-tab')).click();
    await (await unique(page, 'show-more-button')).click();
    await (await unique(page, 'popup-content-container')).getByTestId('search-club-button').click();
    await expect(await unique(page, 'club-search-input')).toBeVisible();
  });

  await test.step('提交关键字并核对两段查询和结果卡片', async () => {
    // 登录和进入俱乐部时可能读取其他俱乐部资料；进入搜索页后才启用定向夹具。
    await clubSearchProxy.inject('club-search-result');
    const searchResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'GET'
        && url.pathname === '/v10/club/search'
        && url.searchParams.get('keyword') === keyword;
    });
    const detailsResponse = page.waitForResponse(response => {
      const request = response.request();
      if (request.method() !== 'PUT' || new URL(response.url()).pathname !== '/v10/clubs') return false;
      try {
        const body: unknown = request.postDataJSON();
        if (!body || typeof body !== 'object' || !('club_ids' in body)) return false;
        const ids = body.club_ids;
        return Array.isArray(ids) && ids.length === 1 && ids[0] === clubId;
      } catch { return false; }
    });
    const input = await unique(page, 'club-search-input');
    await input.fill(keyword);
    await input.press('Enter');

    const search = await searchResponse;
    const details = await detailsResponse;
    expect(search.ok(), '搜索请求应成功').toBe(true);
    expect((await search.json()).result, '搜索结果应指向固定俱乐部').toEqual([clubId]);
    expect(details.ok(), `目标俱乐部资料请求应成功，实际状态码 ${details.status()}`).toBe(true);
    expect(details.request().postDataJSON(), '资料请求应只查询搜索命中的俱乐部').toEqual({ club_ids: [clubId] });

    const card = page.getByTestId('club-search-item-touchable').filter({ visible: true });
    await expect(card, '搜索页应只显示固定俱乐部卡片').toHaveCount(1);
    await expect(card.getByTestId('club-search-item-name')).toHaveText(clubName);
    await expect(input).toHaveValue(keyword);
    const proxyStatus = await clubSearchProxy.status();
    expect(proxyStatus.clubSearchRequests, '代理应收到一次搜索请求').toBe(1);
    expect(proxyStatus.clubDetailsRequests, '代理应收到一次资料请求').toBe(1);

    const closeInstallPrompt = page.getByTestId('add-to-home-close-button').filter({ visible: true });
    if (await closeInstallPrompt.count()) {
      await closeInstallPrompt.click();
      await expect(closeInstallPrompt).toBeHidden();
    }
    await test.info().attach('俱乐部搜索命中结果', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
