import { test } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { adb, artifacts, compareScreenshot, launchApplication, waitForHall } from '../device';

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

    await device.tap({ res: 'username-or-email-sign-in-button' });
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
      await testInfo.attach('last-screen', { body: await device.screenshot(), contentType: 'image/png' }).catch(() => undefined);
      await device.close();
    }
    await testInfo.attach('android-runtime', {
      body: adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E'), contentType: 'text/plain',
    });
  }
});
