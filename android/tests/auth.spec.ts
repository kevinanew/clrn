import { test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb, applicationId, artifacts, compareScreenshot, launchApplication, waitForHall } from '../device';

// 所有操作都通过 APK 的真实原生界面完成，不依赖应用源码或浏览器 DOM。
test('Android Staging 登录与找回密码页面视觉回归', async ({}, testInfo) => {
  test.setTimeout(420_000);
  let device: AndroidDevice | undefined;
  await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
  try {
    device = await launchApplication();
    await waitForHall(device);
    // 大厅的登录入口在折叠区域，原生端通过可见的“我的”入口进入登录页。
    await device.tap({ res: 'settings-tab' });
    await device.tap({ res: 'sign-in-button' });
    await device.wait({ res: 'username-or-email-sign-in-button' });
    await compareScreenshot(device, 'login-welcome', testInfo);

    // Staging 提示覆盖按钮中央，按实际控件边界点击仍可见的右侧，不隐藏提示或修改应用。
    const usernameButton = await device.info({ res: 'username-or-email-sign-in-button' });
    await device.input.tap({
      x: usernameButton.bounds.x + usernameButton.bounds.width - 10,
      y: usernameButton.bounds.y + usernameButton.bounds.height / 2,
    });
    await device.wait({ res: 'username-input' });
    await compareScreenshot(device, 'login-username', testInfo);

    await device.tap({ res: 'forget-password-button' });
    await device.wait({ res: 'reset-password-by-email-button' });
    await compareScreenshot(device, 'forgot-password-method', testInfo);

    await device.tap({ res: 'reset-password-by-email-button' });
    await device.wait({ res: 'email-address-input' });
    await compareScreenshot(device, 'forgot-password-email', testInfo);
  } finally {
    if (device) {
      await device.screenshot()
        .then(body => testInfo.attach('last-screen', { body, contentType: 'image/png' }))
        .catch(() => undefined);
      await device.close()
        .catch(error => testInfo.attach('android-driver-close-error', { body: String(error), contentType: 'text/plain' }))
        .catch(() => undefined);
      try {
        // info() 只返回单个节点；先释放测试驱动的 UiAutomation，再读取被测应用的完整控件树。
        adb('shell', 'am', 'force-stop', 'com.microsoft.playwright.androiddriver');
        adb('shell', 'uiautomator', 'dump', '/sdcard/clrn-visual-hierarchy.xml');
        const hierarchy = adb('shell', 'cat', '/sdcard/clrn-visual-hierarchy.xml');
        if (hierarchy.includes(`package="${applicationId}"`)) {
          await testInfo.attach('android-view-hierarchy', { body: hierarchy, contentType: 'application/xml' });
        } else {
          await testInfo.attach('android-view-hierarchy-error', {
            body: '页面层级中没有被测应用，不能作为应用控件树。', contentType: 'text/plain',
          });
        }
      } catch (error) {
        await testInfo.attach('android-view-hierarchy-error', { body: String(error), contentType: 'text/plain' }).catch(() => undefined);
      }
    }
    try {
      await testInfo.attach('android-runtime', {
        body: adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E'), contentType: 'text/plain',
      });
    } catch (error) {
      await testInfo.attach('android-runtime-error', { body: String(error), contentType: 'text/plain' }).catch(() => undefined);
    }
  }
});
