import { expect, test } from './helpers/mitmproxy';
import { initializePage, openHall, openUsernameLogin, signIn } from './helpers/page';

/**
 * 真实 staging 页面上的弱网行为回归。
 *
 * 浏览器通过每例独立的 mitmproxy 访问站点，代理在目标接口注入延迟或断连。
 * 所有失败均由 Playwright 配置保留 trace，可用 `npx playwright show-trace` 回放。
 */
test.describe('H5 弱网行为', () => {
  test.setTimeout(150_000);

  test.beforeEach(async ({ context }) => {
    await initializePage(context);
  });

  test('大厅首屏超时显示提示，重试后恢复真实牌局列表', async ({ page, mitmproxy }) => {
    await mitmproxy.inject('hall-timeout');

    await openHall(page);

    await expect(page.locator('[data-testid="hall-api-error-alert"]')).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="hall-api-retry-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="hall-screen"]')).toBeVisible();
    expect((await mitmproxy.status()).interceptedRequests).toBeGreaterThan(0);

    // 不只验证有“重试”按钮：解除故障后按真实入口重试，并等待真实列表恢复。
    await mitmproxy.clear();
    const recovered = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/public/v1/hall_matching/available.json');
    await page.getByTestId('hall-api-retry-button').click();
    expect((await recovered).ok(), '重试应重新请求并取得大厅配置').toBe(true);
    await expect(page.getByTestId('hall-api-error-alert')).not.toBeVisible();
    const room = page.getByTestId('match-game-item-texas_holdem-tourists');
    await expect(room.getByTestId('match-game-bet-info')).toHaveText(/^\d+\s*\/\s*\d+$/);
  });

  test('用户名登录接口失败后退出 loading 并显示错误提示', async ({ page, mitmproxy }) => {
    await mitmproxy.inject('login-failure');

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
    expect((await mitmproxy.status()).interceptedRequests).toBeGreaterThan(0);
  });

  test('俱乐部列表接口失败时展示降级界面并允许重试', async ({ page, mitmproxy }) => {
    await openHall(page);
    await signIn(page);

    await mitmproxy.inject('club-failure');

    await page.locator('[data-testid="club-tab"]').click();

    await expect(page.locator('[data-testid="club-list-load-error"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="club-list-retry-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="club-tab-screen"]')).toBeVisible();
    const requestsBeforeRetry = (await mitmproxy.status()).interceptedRequests;
    expect(requestsBeforeRetry).toBeGreaterThan(0);

    await page.locator('[data-testid="club-list-retry-button"]').click();
    await expect(page.locator('[data-testid="club-list-load-error"]')).not.toBeVisible();
    await expect.poll(async () => (await mitmproxy.status()).interceptedRequests)
      .toBeGreaterThan(requestsBeforeRetry);
    // 代理命中只说明重试已开始，客户端的回退请求可能仍在进行。
    // 保持故障，直到界面重新进入可重试的错误状态。
    await expect(page.locator('[data-testid="club-list-load-error"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="club-list-retry-button"]')).toBeVisible();
    await mitmproxy.clear();
    const recovered = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() !== 'OPTIONS'
        && url.pathname === '/v10/club' && url.searchParams.has('user_id');
    });
    await page.locator('[data-testid="club-list-retry-button"]').click();
    expect((await recovered).ok(), '解除故障后应取得真实俱乐部列表').toBe(true);
    await expect(page.locator('[data-testid="club-list-load-error"]')).not.toBeVisible();
  });
});
