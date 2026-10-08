/**
 * 登录/就绪流程共享模块：onReady 场景脚本与 captureAuthState 登录态采集脚本共用。
 */

import { expect } from '@playwright/test';
import { isSignedIn, USER_ATTRIBUTE_STORAGE_KEY } from './authValidation';
export { isSignedIn, waitForSignInState } from './authValidation';

export async function ensureAppReadyPastStaging(page: any): Promise<void> {
  const deadline = Date.now() + 90000;

  while (Date.now() < deadline) {
    const appShellVisible = await page
      .locator('[data-testid="hall-screen"]:visible, [data-testid="hall-tab"]:visible')
      .first()
      .isVisible()
      .catch(() => false);
    if (appShellVisible) {
      // 大厅已挂载后仍可能有异步接口失败弹窗。它会遮住登录入口，必须先关闭，
      // 否则登录态采集会卡在点击大厅“登录”。
      await dismissSignedInPopups(page);
      return;
    }

    const confirmButton = page.locator('[data-testid="confirm-button"]').first();
    const confirmVisible = await confirmButton.isVisible().catch(() => false);
    if (confirmVisible) {
      // noWaitAfter：RN Web 点确认后可能挂起 “waiting for scheduled navigations”
      try {
        await confirmButton.click({ timeout: 3000, noWaitAfter: true });
      } catch {
        await confirmButton.evaluate((el: HTMLElement) => el.click()).catch(() => undefined);
      }
      await page.waitForTimeout(300);
      continue;
    }

    // LaunchScreen 的代理初始化错误使用取消/重试弹窗；取消会绕过初始化，
    // 必须点最后一个「重试」按钮。持续失败仍由整体 deadline 明确终止。
    const startupRetry = page.locator('[data-testid="alert-custom-button"]:visible').last();
    if (await startupRetry.isVisible().catch(() => false)) {
      await startupRetry.click({ timeout: 3000, noWaitAfter: true }).catch(() => undefined);
      await page.waitForTimeout(400);
      continue;
    }

    await page.waitForTimeout(400);
  }

  // 超时后输出现场，方便定位是白屏、报错页还是弹窗卡住
  const currentUrl = page.url();
  const bodyText = await page
    .evaluate(() => document.body?.innerText?.slice(0, 500) || '(empty body)')
    .catch(() => '(evaluate failed)');
  console.log(`DEBUG URL > ${currentUrl}`);
  console.log(`DEBUG BODY > ${bodyText}`);

  throw new Error('应用未能在超时内进入大厅（staging 弹窗或初始化卡住）');
}

/** 等待超时后输出现场（可见文案 / 弹窗 / DOM 摘要），方便定位卡在哪一步 */
export async function dumpPageState(page: any, where: string): Promise<void> {
  const state = await page
    .evaluate(() => {
      const texts = Array.from(document.querySelectorAll('div,span,p,button'))
        .filter((el) => el.children.length === 0 && el.textContent?.trim())
        .slice(0, 30)
        .map((el) => el.textContent?.trim().slice(0, 40));
      const testIds = Array.from(document.querySelectorAll('[data-testid]'))
        .slice(0, 40)
        .map((el) => el.getAttribute('data-testid'));
      // modal/弹窗一般挂在 #root 末尾，取根节点最后几个子树的摘要
      const root = document.getElementById('root');
      const tailSummaries = Array.from(root?.children[0]?.children || [])
        .slice(-4)
        .map((el) => {
          const ids = Array.from(el.querySelectorAll('[data-testid]'))
            .slice(0, 10)
            .map((n) => n.getAttribute('data-testid'));
          const text = (el as HTMLElement).innerText?.trim().slice(0, 120) || '';
          return { ids, text };
        });
      return {
        url: window.location.href,
        bodyLength: document.body?.innerHTML.length || 0,
        texts,
        testIds,
        tailSummaries,
      };
    })
    .catch(() => null);
  console.log(`DEBUG (${where}) > ${JSON.stringify(state)}`);
}

/** RN Web 的 TextInput testID 可能落在 input 本体或容器上，统一处理 */
export async function fillByTestId(page: any, testId: string, value: string): Promise<void> {
  const input = await inputByTestId(page, testId);
  await input.fill(value);
}

async function inputByTestId(page: any, testId: string) {
  const target = page.locator(`[data-testid="${testId}"]`).first();
  await target.waitFor({ state: 'visible', timeout: 60000 });
  const tagName = await target.evaluate((el: Element) => el.tagName);
  return tagName === 'INPUT' || tagName === 'TEXTAREA'
    ? target
    : target.locator('input, textarea').first();
}

/**
 * 用户名登录页挂载时会用已保存账号初始化输入框。React effect 偶尔会在页面已可见
 * 后才执行，清掉刚由 Playwright 填入的凭据，令提交按钮保持 disabled。确认一小段
 * 稳定窗口；若碰到这次初始化则重新填充，而不是提交空表单后等待登录态超时。
 */
export async function fillStableSignInCredentials(
  page: any,
  credentials: { username: string; password: string },
): Promise<void> {
  const usernameInput = await inputByTestId(page, 'username-input');
  const passwordInput = await inputByTestId(page, 'password-input');

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await usernameInput.fill(credentials.username);
    await passwordInput.fill(credentials.password);
    await page.waitForTimeout(300);

    if (
      (await usernameInput.inputValue()) === credentials.username &&
      (await passwordInput.inputValue()) === credentials.password
    ) {
      return;
    }
  }

  throw new Error('登录表单初始化持续覆盖测试凭据，无法安全提交登录请求');
}

/**
 * 登录页导航栈会保留首页；通用 sign-in-button 不能按整个页面的 DOM 顺序选择。
 * 用户名表单提交控件带有专属 nativeID；再从密码输入框向后限定，避免重绘后命中
 * 被保留的首页控件，同时保留现有原生/网页自动化所依赖的通用 testID。
 */
export async function usernameOrEmailSubmitButton(page: any) {
  const passwordInput = await inputByTestId(page, 'password-input');
  const submit = passwordInput
    .locator(
      'xpath=following::*[@id="username-or-email-submit-button" and @data-testid="sign-in-button"]',
    )
    .first();
  await submit.waitFor({ state: 'visible', timeout: 60000 });
  return submit;
}

/**
 * RN Web 的受控 TextInput 会在 input 事件后异步提交 MobX 更新。仅确认原生 input
 * 的 value 已改变还不足以说明登录回调已可用：TouchableOpacity 在此窗口仍会保留
 * aria-disabled，Playwright 对该 div 的 click 不会触发 onPress。提交前等待它可用，
 * 而非把一次无效点击误判为服务端登录超时。
 */
export async function waitForUsernameOrEmailSubmitEnabled(submit: any): Promise<void> {
  await expect(submit).toBeEnabled({ timeout: 60000 });
}

/**
 * 固定账号登录：大厅 → 登录页 → 用户名或邮箱登录。
 * 该界面自带注册逻辑（用户名不存在时先调注册 API 再登录），
 * 因此固定账号首次运行会自动注册，之后直接登录，测试用户稳定。
 * 注：游客登录（register/device）在 Web 端不渲染，不能使用。
 */
export async function ensureSignedIn(
  page: any,
  credentials: { username: string; password: string },
): Promise<void> {
  if (await isSignedIn(page)) {
    return;
  }

  const hallSignIn = page.locator('[data-testid="hall-sign-in-button"]:visible').first();
  // 接口失败弹窗可在进入大厅后晚到一拍；再清理一次，保证点击前没有遮罩。
  await dismissSignedInPopups(page);
  await hallSignIn.waitFor({ state: 'attached', timeout: 60000 });
  // 必须显式限时：对 Playwright 误判不可见的元素该调用会无限等待
  await hallSignIn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await hallSignIn.click();

  const usernameEntry = page.locator('[data-testid="username-or-email-sign-in-button"]').first();
  await usernameEntry.waitFor({ state: 'visible', timeout: 60000 });
  await usernameEntry.click();

  const submit = await usernameOrEmailSubmitButton(page);
  await fillStableSignInCredentials(page, credentials);
  await waitForUsernameOrEmailSubmitEnabled(submit);
  await submit.click();

  // 登录成功后 UserAttribute 会写入 localStorage。等级徽章依赖另一条接口，不能用它
  // 判断认证是否成功。
  try {
    await page.waitForFunction(
      (storageKey: string) => {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          return false;
        }
        try {
          const parsed = JSON.parse(raw);
          return Boolean(
            parsed?.user_id && parsed?.api_token?.access_token && parsed?.api_token?.token_type,
          );
        } catch {
          return false;
        }
      },
      USER_ATTRIBUTE_STORAGE_KEY,
      { timeout: 90000 },
    );
  } catch (error) {
    await dumpPageState(page, 'sign-in state timeout');
    throw error;
  }

  // 等登录 modal 完全关闭（遮罩会拦截底部 tab 的点击）
  await usernameEntry.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

/**
 * 登录后可能出现的弹窗（隐私政策、签到、邀请等），尽力关掉，避免遮挡截图。
 * 一轮检查没有弹窗即认为干净（每场景会在多个节点各调一次，整体覆盖足够）。
 */
export async function dismissSignedInPopups(page: any): Promise<void> {
  const closeSelectors = [
    // 大厅的可选玩法接口偶发失败时会弹出“取消 / 重试”。采集登录态时取消即可，
    // 重试会再次触发网络请求并使弹窗反复出现。
    '[data-testid="hall-api-error-alert"] [data-testid="alert-custom-button"]',
    // 其它异步接口也可能使用双按钮通用 Alert。取第一个按钮（取消），避免点击
    // “重试”再次发起同一个易碎请求。该类 Alert 可能在页面就绪后才出现。
    '[data-testid="alert-custom-button"]',
    '[data-testid="privacy-popup-agree"]',
    // 「网络有点问题，请重试」等通用 alert 的确认按钮（staging 接口偶发失败）
    '[data-testid="alert-ok-button"]',
    '[data-testid="check-in-success-popup-close"]',
    '[data-testid="join-game-modal-close-button"]',
  ];

  // 弹窗可能略有延迟，先留 500ms 再开始检查
  await page.waitForTimeout(500);

  for (let round = 0; round < 6; round += 1) {
    let closedAny = false;
    for (const selector of closeSelectors) {
      const closeButton = page.locator(selector).first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click().catch(() => undefined);
        await page.waitForTimeout(400);
        closedAny = true;
      }
    }
    if (!closedAny) {
      return;
    }
  }
}
