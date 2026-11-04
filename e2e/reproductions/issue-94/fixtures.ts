/** 真实登录后在内存中恢复同一会话并录像；绝不录制密码表单或写出登录状态。 */
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as accountTest, expect } from '../../cases/_shared/creation-account-fixture';
import { openHall } from '../../cases/_shared/page';
import { environment } from '../../helpers/environment';
import { withMitmproxy } from '../../helpers/mitmproxy-session';
import type { Mitmproxy } from '../../helpers/mitmproxy-client';
import { installConnectionDiagnostics } from '../../../visual/src/support/connectionDiagnostics';
import { screenshotAfterSettling } from './screenshot';

export const test = accountTest.extend<{ faultProxy: Mitmproxy; tablePage: Page }>({
  /**
   * 复用每例代理及证书生命周期，附加准确房间的定向故障插件。
   * @param fixtures - Playwright fixture 依赖。
   * @param use - 使用独立代理的案例。
   */
  faultProxy: async ({}, use) => {
    await withMitmproxy(use, { addonPath: path.resolve(__dirname, '../../mitmproxy/texas_faults.py') });
  },
  /**
   * 登录和初始化均经过透传代理，业务开始后才配置故障。
   * @param fixtures - 当前代理。
   * @param use - 使用本轮代理的浏览器配置。
   */
  proxy: async ({ faultProxy }, use) => { await use({ server: faultProxy.server, bypass: '<-loopback>' }); },
  ignoreHTTPSErrors: true,
  /**
   * 完成真实登录后才创建录像上下文，保留正常应用初始化和业务请求。
   * @param fixtures - 已真实登录的页面、账号及代理。
   * @param use - 使用登录后页面的案例。
   * @param information - 当前输出目录和测试结果。
   */
  tablePage: async ({ browser, page, newAccount, faultProxy }, use, information) => {
    expect(newAccount.userId).toBeTruthy();
    const context = await browser.newContext({
      baseURL: environment.stagingUrl,
      storageState: await page.context().storageState(),
      proxy: { server: faultProxy.server, bypass: '<-loopback>' },
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: information.outputPath('video') },
    });
    await page.close();
    const recorded = await context.newPage();
    const diagnostics = await installConnectionDiagnostics(context, recorded, information);
    try {
      await openHall(recorded);
      await expect(recorded.getByTestId('hall-auth-state-signed-in')).toBeVisible({ timeout: 30_000 });
      await use(recorded);
    } finally {
      try {
        if (information.status !== information.expectedStatus && !recorded.isClosed()) {
          await screenshotAfterSettling(recorded, information.outputPath('failure.png'));
        }
      } finally {
        try { await diagnostics.save(information.error); }
        finally { await context.close(); }
      }
      const video = await recorded.video()?.path();
      if (video) await information.attach('signed-in-video', { path: video, contentType: 'video/webm' });
    }
  },
});

export { expect };
