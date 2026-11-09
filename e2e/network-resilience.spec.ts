import { expect, test } from './helpers/mitmproxy';
import { initializePage, openHall, openUsernameLogin, signIn } from './helpers/page';
import { clickAfterSignInNotices } from './cases/_shared/sign-in-notices';

/**
 * 真实 staging 页面上的弱网行为回归。
 *
 * 浏览器通过每例独立的 mitmproxy 访问站点，代理在目标接口注入延迟或断连。
 * 失败时保留页面错误上下文；含私有登录密码的网络 trace 不写入报告。
 */
test.describe('H5 弱网行为', /** 覆盖H5 弱网行为。 */ () => {
  test.setTimeout(150_000);

  test.beforeEach(/** 每个弱网用例开始前初始化浏览器存储与页面环境。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ context }) => {
    await initializePage(context);
  });

  test('大厅首屏超时显示提示，重试后恢复真实牌局列表', /** 验证大厅首屏超时显示提示，重试后恢复真实牌局列表。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, mitmproxy }) => {
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
    const recovered = page.waitForResponse(/** 匹配`/public/v1/hall_matching/available.json` 的响应，避免捕获其他请求。
 * @param response - 当前收到的接口响应。 */ response =>
      new URL(response.url()).pathname === '/public/v1/hall_matching/available.json');
    await page.getByTestId('hall-api-retry-button').click();
    expect((await recovered).ok(), '重试应重新请求并取得大厅配置').toBe(true);
    await expect(page.getByTestId('hall-api-error-alert')).not.toBeVisible();
    const room = page.getByTestId('match-game-item-texas_holdem-tourists');
    await expect(room.getByTestId('match-game-bet-info')).toHaveText(/^\d+\s*\/\s*\d+$/);
  });

  test('用户名登录接口失败后退出 loading 并显示错误提示', /** 验证用户名登录接口失败后退出 loading 并显示错误提示。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, mitmproxy }) => {
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

    // 断连后 SDK 会重新选线（每轮节点探测最多 5s），再执行一次登录回退请求。
    // 等完整故障流程退出 loading，不能用默认 5s 在选线尚未结束时判定失败。
    await expect(page.locator('[data-testid="username-sign-in-error-alert"]')).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="sign-in-button"]:visible').last()).toContainText(
      '登录或注册',
    );
    expect((await mitmproxy.status()).interceptedRequests).toBeGreaterThan(0);
  });

  test('俱乐部列表接口失败时展示降级界面并允许重试', /** 验证俱乐部列表接口失败时展示降级界面并允许重试。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, mitmproxy }) => {
    await openHall(page);
    await signIn(page);

    await mitmproxy.inject('club-failure');

    // 新账号可能收到救济金或隐私提示，先通过已知按钮处理，再执行实际点击。
    await clickAfterSignInNotices(page, 'club-tab');

    await expect(page.locator('[data-testid="club-list-load-error"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="club-list-retry-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="club-tab-screen"]')).toBeVisible();
    const requestsBeforeRetry = (await mitmproxy.status()).interceptedRequests;
    expect(requestsBeforeRetry).toBeGreaterThan(0);

    await page.locator('[data-testid="club-list-retry-button"]').click();
    await expect(page.locator('[data-testid="club-list-load-error"]')).not.toBeVisible();
    await expect.poll(/** 轮询代理命中数量，等待网络故障场景实际触发。 */ async () => (await mitmproxy.status()).interceptedRequests)
      .toBeGreaterThan(requestsBeforeRetry);
    // 代理命中只说明重试已开始，客户端的回退请求可能仍在进行。
    // 保持故障，直到界面重新进入可重试的错误状态。
    await expect(page.locator('[data-testid="club-list-load-error"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="club-list-retry-button"]')).toBeVisible();
    await mitmproxy.clear();
    const recovered = page.waitForResponse(/** 匹配`/v10/club` 的响应，避免捕获其他请求。
 * @param response - 当前收到的接口响应。 */ response => {
      const url = new URL(response.url());
      return response.request().method() !== 'OPTIONS'
        && url.pathname === '/v10/club' && url.searchParams.has('user_id');
    });
    await page.locator('[data-testid="club-list-retry-button"]').click();
    expect((await recovered).ok(), '解除故障后应取得真实俱乐部列表').toBe(true);
    await expect(page.locator('[data-testid="club-list-load-error"]')).not.toBeVisible();
  });
});
