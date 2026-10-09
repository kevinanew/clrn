import { type BrowserContext, expect, type Response, type Page } from '@playwright/test';
import { environment } from './environment';

const RETRYABLE_NAVIGATION_ERRORS =
  /(?:page\.goto: Timeout \d+ms exceeded|net::ERR_(?:CONNECTION_(?:ABORTED|CLOSED|RESET)|NETWORK_CHANGED|TIMED_OUT)|is interrupted by another navigation to "chrome-error:\/\/chromewebdata\/")/;
const RETRY_DELAY_MS = 1_000;

/**
 * 打开部署站点并处理首次 staging 确认提示。
 * @param page - 执行操作的 Playwright 页面。
 * @param url - 要访问的站点或本机服务地址。
 */
export async function gotoDeployedSite(page: Page, url: string): Promise<Response | null> {
  // 一次原始请求加两次重试：短暂断连可以恢复，持续故障仍会在同一用例中失败。
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      const shouldRetry =
        attempt < maximumAttempts &&
        error instanceof Error &&
        RETRYABLE_NAVIGATION_ERRORS.test(error.message);
      if (!shouldRetry) {
        throw error;
      }

      // 连续重试会落在同一个刚关闭的代理/TCP 连接窗口中；短暂等待后再试，
      // 仍保持三次上限和原有的持续故障失败语义。
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }

  throw new Error(`无法导航到 ${url}`);
}

/**
 * 为新浏览器上下文预置语言与新手引导标记。
 * @param context - 首次导航前配置的浏览器上下文。
 */
export async function initializePage(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('app.language.code.key', 'zh-Hans');
    window.localStorage.setItem('deviceId', 'e2e-weak-network-device-id');
    window.localStorage.setItem('hall.screen.tutorial.complete.key', 'true');
  });
}

/**
 * 打开部署站点，处理 staging 提示并等待大厅就绪。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function openHall(page: Page): Promise<void> {
  await page.goto(environment.stagingUrl, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: /^(确定|OK)$/ })
    .first()
    .click({ timeout: 5_000 })
    .catch(() => undefined);
  await expect(page.locator('[data-testid="hall-screen"]')).toBeVisible({ timeout: 60_000 });
  await dismissAppAlert(page);
}

/**
 * 从登录入口切换到用户名和密码登录表单。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function openUsernameLogin(page: Page): Promise<void> {
  await page.locator('[data-testid="hall-sign-in-button"]').click({ timeout: 30_000 });
  await page.locator('[data-testid="username-or-email-sign-in-button"]').click({ timeout: 30_000 });
  await expect(page.locator('[data-testid="username-input"]')).toBeVisible();
}

/**
 * 使用环境配置的账号从真实界面登录，并等待大厅认证状态成立。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function signIn(page: Page): Promise<void> {
  await openUsernameLogin(page);
  await page
    .locator('[data-testid="username-input"] input, input[data-testid="username-input"]')
    .first()
    .fill(environment.testUsername);
  await page
    .locator('[data-testid="password-input"] input, input[data-testid="password-input"]')
    .first()
    .fill(environment.testPassword);
  await page.locator('[data-testid="sign-in-button"]:visible').last().click();
  await expect(page.locator('[data-testid="hall-user-level-text"]')).toBeVisible({
    timeout: 90_000,
  });
  await dismissAppAlert(page);
  await page
    .getByRole('dialog')
    .filter({ hasText: '用户隐私策略概要' })
    .getByText('同意', { exact: true })
    .click({ force: true, timeout: 2_000 })
    .catch(() => undefined);
  await dismissAppAlert(page);
}

/**
 * 关闭当前应用提示弹窗，避免遮挡后续操作。
 * @param page - 执行操作的 Playwright 页面。
 */
async function dismissAppAlert(page: Page): Promise<void> {
  await page
    .locator('[data-testid="alert-ok-button"]')
    .first()
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  await page
    .getByRole('dialog')
    .getByText('好的', { exact: true })
    .click({ force: true, timeout: 2_000 })
    .catch(() => undefined);
}
