import { expect, type HTTPResponse, type Page, test } from '@playwright/test';
import { expectBuildVersion, expectSiteReady } from './helpers/assertions';
import { environment } from './helpers/environment';
import { gotoDeployedSite } from './helpers/page';
import { sites } from './helpers/sites';

/**
 * 已部署 H5 站点可用性冒烟：页面可打开、标题正确、应用根节点已挂载。
 *
 * Staging: E2E_STAGING_URL 环境变量指定的站点。
 * Production:
 *   - https://h5.laiwan.life/
 *   - https://h5.laiwanpai.com/
 *   - https://h5.goplay360.com/
 */
test('站点导航遇到瞬态网络错误时有限重试', async ({ page }) => {
  let attempts = 0;
  let timedOutAttemptStartedAt = 0;
  let timedOutAttemptElapsed = 0;
  await page.route('https://navigation-retry.invalid/', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.abort('connectionclosed');
      return;
    }
    if (attempts === 2) {
      timedOutAttemptStartedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 300));
      timedOutAttemptElapsed = Date.now() - timedOutAttemptStartedAt;
      await route.abort('timedout');
      return;
    }
    await route.fulfill({ contentType: 'text/html', body: '<main>ready</main>' });
  });

  const response = await gotoDeployedSite(page, 'https://navigation-retry.invalid/');

  expect(response?.ok()).toBeTruthy();
  expect(attempts).toBe(3);
  expect(timedOutAttemptElapsed).toBeGreaterThanOrEqual(250);
});

test('站点导航在退避后重试可恢复的网络错误', async () => {
  let attempts = 0;
  const attemptStartedAt: number[] = [];
  const page = {
    goto: async () => {
      attemptStartedAt.push(Date.now());
      attempts += 1;
      if (attempts === 1) {
        throw new Error('page.goto: net::ERR_CONNECTION_CLOSED at https://h5.laiwanpai.com/');
      }
      if (attempts === 2) {
        throw new Error(
          'Navigation to "https://h5.laiwanpai.com/" is interrupted by another navigation to "chrome-error://chromewebdata/"',
        );
      }
      return { ok: () => true } as HTTPResponse;
    },
  } as unknown as Page;

  const response = await gotoDeployedSite(page, 'https://h5.laiwanpai.com/');

  expect(response?.ok()).toBeTruthy();
  expect(attempts).toBe(3);
  expect(attemptStartedAt[1] - attemptStartedAt[0]).toBeGreaterThanOrEqual(900);
  expect(attemptStartedAt[2] - attemptStartedAt[1]).toBeGreaterThanOrEqual(1_900);
});

test('站点导航自身超时时重试三次后终止', async ({ page }) => {
  const navigationAttemptTimeoutMs = 100;
  page.setDefaultNavigationTimeout(navigationAttemptTimeoutMs);
  let attempts = 0;
  await page.route('https://navigation-timeout.invalid/', async (route) => {
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({ contentType: 'text/html', body: '<main>too late</main>' });
  });

  const startedAt = Date.now();
  await expect(gotoDeployedSite(page, 'https://navigation-timeout.invalid/')).rejects.toThrow(
    `page.goto: Timeout ${navigationAttemptTimeoutMs}ms exceeded`,
  );
  const elapsed = Date.now() - startedAt;

  expect(attempts).toBe(3);
  expect(elapsed).toBeGreaterThanOrEqual(navigationAttemptTimeoutMs * attempts - 50);
  // 两次退避合计 3 秒；此上界仍确保持续故障会在有限时间内终止。
  expect(elapsed).toBeLessThan(5_000);
});

for (const site of sites) {
  test(`${site.name} 网站可用 (${site.url})`, async ({ page }) => {
    const response = await gotoDeployedSite(page, site.url);

    expect(response, `应收到 HTTP 响应: ${site.url}`).not.toBeNull();
    expect(response!.ok(), `HTTP 状态应成功: ${response!.status()} ${site.url}`).toBeTruthy();

    await expectSiteReady(page, site.url);
    // 当前流水线会在部署前运行，因此仅在部署后显式指定目标提交时校验版本。
    if (environment.expectedBuildSha) {
      await expectBuildVersion(page, site.url);
    }
  });
}
