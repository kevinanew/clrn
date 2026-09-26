import type { Page } from '@playwright/test';
import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';

async function openSetting(page: Page, id: string) {
  await (await unique(page, 'settings-list')).hover();
  for (let n = 0; n < 12 && !(await page.getByTestId(id).count()); n++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
  }
  await (await unique(page, id)).click();
}

test('SETTINGS-005：语言偏好、关于、官网与分享入口浏览', async ({ page, signedInAccount }) => {
  test.setTimeout(180_000);
  await test.step('登录并打开我的', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'settings-tab')).click();
  });
  await test.step('语言列表展示当前选中项，返回后保留简体中文', async () => {
    await openSetting(page, 'application-management');
    await expect(await unique(page, 'language')).toHaveText('语言');
    await (await unique(page, 'language')).click();
    const simplified = await unique(page, 'zh-hans');
    await expect(simplified).toContainText('简体中文');
    await expect(simplified.getByTestId('checkmark-icon')).toHaveCount(1);
    await expect(await unique(page, 'english')).toContainText('English');
    await expect(await unique(page, 'zh-hant')).toContainText('繁體中文');
    await goBack(page);
    await expect(await unique(page, 'language')).toHaveText('语言');
    await goBack(page);
  });
  await test.step('关于显示实际版本和协议入口', async () => {
    await openSetting(page, 'about-laiwan');
    await expect(await unique(page, 'app-version-text')).toHaveText(/\d/);
    await expect(await unique(page, 'current-version-title')).toHaveText('当前版本');
    await expect(await unique(page, 'agreement-title')).toHaveText('用户协议');
    await expect(await unique(page, 'privacy-title')).toHaveText('隐私政策');
    await goBack(page);
  });
  await test.step('官网列表展示三个 HTTPS 地址', async () => {
    await openSetting(page, 'official-site');
    for (const n of [1, 2, 3]) {
      await expect(await unique(page, `official-site-${n}-text`)).toHaveText(/^https:\/\/\S+$/);
    }
    await goBack(page);
  });
  await test.step('分享页展示下载地址和扫码说明', async () => {
    await openSetting(page, 'share-app');
    await expect(await unique(page, 'app-name-text')).toHaveText('来玩');
    await expect(await unique(page, 'scan-app-text')).toContainText('手机自带扫描二维码功能');
    await expect(await unique(page, 'download-url-text')).toHaveText(/^https:\/\//);
    await expect(await unique(page, 'url-text')).toHaveText(/^https:\/\//);
    await goBack(page);
  });
  await test.step('频道入口展示官方频道 URL', async () => {
    await openSetting(page, 'telegram-channel');
    await expect(await unique(page, 'channel-url-tips')).toHaveText('点击链接加入我们的频道');
    await expect(await unique(page, 'channel-url-button')).toHaveText('https://t.me/laiwanpai');
    await goBack(page);
    await expect(await unique(page, 'settings-screen')).toBeVisible();
  });
});
