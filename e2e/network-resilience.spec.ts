import { expect, test } from '@playwright/test';
import { initializePage, openHall, openUsernameLogin, signIn } from './helpers/page';

/**
 * 真实 staging 页面上的弱网行为回归。
 *
 * 路由必须在导航前安装，避免接口已在应用初始化阶段发出而漏掉注入。
 * 所有失败均由 Playwright 配置保留 trace，可用 `npx playwright show-trace` 回放。
 */
test.describe('H5 弱网行为', () => {
  test.setTimeout(150_000);

  test.beforeEach(async ({ context }) => {
    await initializePage(context);
  });

  test('大厅首屏接口长延迟超时后显示重试提示', async ({ page }) => {
    let interceptedRequests = 0;
    await page.route('**/public/v1/hall_matching/available.json', async (route) => {
      interceptedRequests += 1;
      // 长于客户端请求超时，确保覆盖“请求已发出但迟迟没有响应”的真实弱网路径。
      // 只有首次请求延迟；后续回退请求立即失败，避免把测试结束时仍在进行的
      // 自动重试拖成长时间的 route handler。
      if (interceptedRequests === 1) {
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      }
      await route.abort('timedout').catch(() => undefined);
    });

    await openHall(page);

    await expect(page.locator('[data-testid="hall-api-error-alert"]')).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="hall-api-retry-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="hall-screen"]')).toBeVisible();
    expect(interceptedRequests).toBeGreaterThan(0);
  });

  test('用户名登录接口失败后退出 loading 并显示错误提示', async ({ page }) => {
    await page.route('**/public/v10/user/username/is_existed', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { is_existed: true } }),
      }),
    );
    let interceptedRequests = 0;
    await page.route('**/public/v10/user/login/username/password', (route) => {
      interceptedRequests += 1;
      return route.abort('failed');
    });

    await openHall(page);
    await openUsernameLogin(page);
    await page
      .locator('[data-testid="username-input"] input, input[data-testid="username-input"]')
      .first()
      .fill('weaknetwork');
    await page
      .locator('[data-testid="password-input"] input, input[data-testid="password-input"]')
      .first()
      .fill('weaknetwork');
    await page.locator('[data-testid="sign-in-button"]:visible').last().click();

    await expect(page.locator('[data-testid="username-sign-in-error-alert"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-button"]:visible').last()).toContainText(
      '登录或注册',
    );
    expect(interceptedRequests).toBeGreaterThan(0);
  });

  test('俱乐部列表接口失败时展示降级界面并允许重试', async ({ page }) => {
    await openHall(page);
    await signIn(page);

    let interceptedRequests = 0;
    await page.route(
      (url) => url.pathname === '/v10/club' && url.searchParams.has('user_id'),
      (route) => {
        interceptedRequests += 1;
        return route.abort('failed');
      },
    );

    await page.locator('[data-testid="club-tab"]').click();

    await expect(page.locator('[data-testid="club-list-load-error"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="club-list-retry-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="club-tab-screen"]')).toBeVisible();
    expect(interceptedRequests).toBeGreaterThan(0);
  });
});
