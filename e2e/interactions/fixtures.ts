import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import { environment } from '../helpers/environment';
import { gotoDeployedSite, initializePage } from '../helpers/page';
import { signIn } from '../cases/_shared/auth';
import { clickAfterSignInNotices, installSignInNoticeHandler } from '../cases/_shared/sign-in-notices';

const baseURL = process.env.E2E_INTERACTION_BASE_URL || environment.stagingUrl;
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * 固定引导标记及非目标接口，保留真实组件、布局、导航和账号鉴权。
 * @param context - 需要配置初始化脚本与网络边界的浏览器上下文。
 */
async function prepare(context: BrowserContext): Promise<void> {
  await initializePage(context);
  await context.addInitScript(
    /** 标记已完成新手引导。 */ () => {
      for (const name of ['personal.house', 'create.room']) {
        localStorage.setItem(`${name}.screen.tutorial.complete.key`, 'true');
      }
    },
  );
  await context.route(
    '**/public/v1/hall_matching/available.json',
    /**
     * 返回可用大厅版本。
     * @param route - 当前拦截到的请求，用于提供场景响应。
     */ (route) =>
      route.fulfill({ json: { ok: true, result: { available_url_version: ['v3'] } } }),
  );
  // 维护提醒接口在 staging 偶发返回 401，与滚动场景无关，且会清除有效登录态。
  await context.route(
    '**/v2/room/disallow-rule/reminder',
    /**
     * 关闭与交互无关的维护提醒。
     * @param route - 当前拦截到的请求，用于提供场景响应。
     */ (route) =>
      route.fulfill({ json: { ok: true, result: { enable: false, message: '' } } }),
  );
}

/**
 * 正常点击启动提示；不隐藏节点，也不忽略点击被遮挡的错误。
 * @param page - 执行交互的 Playwright 页面。
 * @param signedIn - 是否等待大厅显示已登录状态。
 */
export async function openApp(page: Page, signedIn = true): Promise<void> {
  await gotoDeployedSite(page, baseURL);
  const startup = page.getByTestId('confirm-button');
  await expect(page.getByTestId('hall-screen').or(startup).first()).toBeVisible({
    timeout: 60_000,
  });
  if (await startup.isVisible()) {
    await startup.click();
  }
  await expect(page.getByTestId('hall-screen')).toBeVisible({ timeout: 60_000 });
  if (signedIn) {
    await expect(page.getByTestId('hall-auth-state-signed-in')).toBeVisible();
  }
}

/**
 * 仅关闭明确的首次登录提示，交互中出现的错误与遮罩交给测试暴露。
 * @param page - 执行交互的 Playwright 页面。
 */
async function dismissWelcome(page: Page): Promise<void> {
  for (const id of ['privacy-popup-agree', 'check-in-success-popup-close']) {
    const button = page.getByTestId(id);
    if (await button.isVisible()) {
      await button.click();
      await expect(button).toBeHidden();
    }
  }
  // 新账号金币余额较低时会提示救济金；取消领取后再进入交互测试。
  await clickAfterSignInNotices(page, 'hall-tab');
}

export const test = base.extend<object, { accountState: StorageState }>({
  accountState: [
    /**
     * 每个 worker 真实登录一次，继承项目语言配置并在内存中复用会话。
     * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
     * @param use - 将准备好的会话传给依赖此 fixture 的测试。
     * @param workerInfo - 当前 worker 的项目配置，用于继承浏览器语言。
     */ async (
      { browser },
      use,
      workerInfo,
    ) => {
      // 手动创建的上下文不会继承 use.locale，Linux 的 en-US@posix 会导致应用启动异常。
      const context = await browser.newContext({
        locale: workerInfo.project.use.locale || 'zh-CN',
      });
      let state: StorageState;
      try {
        await prepare(context);
        const page = await context.newPage();
        await openApp(page, false);
        // 复用仅定位可见表单的真实登录流程，阻断账号缺失时的自动注册。
        await signIn(page);
        await dismissWelcome(page);
        state = await context.storageState();
      } finally {
        await context.close();
      }
      await use(state);
    },
    // 导航最多三次（180 秒）加大厅就绪、登录各 60 秒，避免准备时限先于具体断言触发。
    { scope: 'worker', timeout: 360_000 },
  ],
  storageState: /**
   * 将当前账号会话传入测试上下文。
   * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
   * @param use - 将准备好的会话传给依赖此 fixture 的测试。
   */ async ({ accountState }, use) => {
    await use(accountState);
  },
});

test.beforeEach(
  /**
   * 每个场景安装独立接口边界，并处理复用会话后延迟出现的登录提示。
   * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
   */ async ({ context, page }) => {
    await prepare(context);
    await installSignInNoticeHandler(page);
  },
);

export { expect };
