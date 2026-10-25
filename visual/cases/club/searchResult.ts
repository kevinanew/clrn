/** 在视觉测试的固定 Linux 浏览器中采集俱乐部搜索命中结果。 */
import { expect, type Browser } from '@playwright/test';
import type { VisualScenario } from '../../scenarioTypes';
import { visualBaseUrl } from '../../target';
import { buildStorageStateForScenario, setupContextForScenario } from '../../src/support/pageSetup';
import { preparePage } from '../../src/support/preparePage';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

const keyword = 'VisualClubSearch';
const clubId = '12f2cb6e-9045-4910-b58a-7d3903f56a39';

export async function runClubSearchResultScenario(scenario: VisualScenario, browser: Browser): Promise<void> {
  await withMitmproxy(async proxy => {
    const context = await browser.newContext({
      proxy: { server: proxy.server, bypass: '<-loopback>' },
      ignoreHTTPSErrors: true,
      viewport: { width: scenario.viewport.width, height: scenario.viewport.height },
      locale: 'en-US',
      deviceScaleFactor: 1,
      storageState: buildStorageStateForScenario(scenario, visualBaseUrl),
    });
    try {
      const page = await context.newPage();
      await setupContextForScenario(context, scenario, page, { useMitmproxy: true, clubDetailsFromProxy: true });
      await page.goto(scenario.path);
      await preparePage(page, scenario);
      await proxy.inject('club-search-result');
      const searchResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && url.pathname === '/v10/club/search'
          && url.searchParams.get('keyword') === keyword;
      });
      const input = page.getByTestId('club-search-input').filter({ visible: true });
      await input.fill(keyword);
      await input.press('Enter');
      expect((await (await searchResponse).json()).result, '搜索响应应返回固定俱乐部编号').toEqual([clubId]);
      const card = page.getByTestId('club-search-item-touchable').filter({ visible: true });
      await expect(card, '搜索页应显示唯一命中卡片').toHaveCount(1);
      await expect(card.getByTestId('club-search-item-name')).toHaveText('搜索测试俱乐部');
      await expect(input).toHaveValue(keyword);
      const status = await proxy.status();
      expect(status.clubSearchRequests, '代理应收到一次搜索请求').toBe(1);
      expect(status.clubDetailsRequests, '代理应收到一次资料请求').toBe(1);
      const closeInstallPrompt = page.getByTestId('add-to-home-close-button').filter({ visible: true });
      if (await closeInstallPrompt.count()) {
        await closeInstallPrompt.click();
        await expect(closeInstallPrompt).toBeHidden();
      }
      await expect(page).toHaveScreenshot(`${scenario.label}.png`);
    } finally {
      await context.close();
    }
  });
}
