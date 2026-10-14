import { test as base } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { adb, artifacts, launchApplication, waitForHall } from './device';
import { withAndroidProxy } from './proxy';
import { selectLanguage } from './navigation';

export const locale = process.env.ANDROID_LOCALE || 'en';
export const test = base.extend<{}, { application: { device: AndroidDevice; signedIn: boolean } }>({
  application: [async ({}, use) => {
    await withAndroidProxy(async () => {
      const device = await launchApplication();
      try {
        await waitForHall(device);
        await selectLanguage(device, locale);
        await use({ device, signedIn: false });
      } finally {
        await device.close();
      }
    });
  }, { scope: 'worker', timeout: 240_000 }],
});

test.afterEach(async ({ application }, testInfo) => {
  await testInfo.attach('build-info', { path: `${artifacts}/build-info.json`, contentType: 'application/json' });
  if (testInfo.status === testInfo.expectedStatus) return;
  await application.device.screenshot().then(body => testInfo.attach('last-screen', { body, contentType: 'image/png' }))
    .catch(() => undefined);
  // info 的根节点包含完整子树，不释放当前测试连接即可保留错误现场。
  await application.device.info({ depth: 0 }).then(async tree => {
    const filename = testInfo.outputPath('hierarchy.json');
    await writeFile(filename, JSON.stringify(tree, null, 2));
    await testInfo.attach('hierarchy', { path: filename, contentType: 'application/json' });
  }).catch(() => undefined);
  await testInfo.attach('runtime', {
    body: adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E'), contentType: 'text/plain',
  }).catch(() => undefined);
});
