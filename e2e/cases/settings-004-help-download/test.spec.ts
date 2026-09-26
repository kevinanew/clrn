import type { Page } from '@playwright/test';
import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';

async function openSetting(page: Page, id: string) {
  const list = await unique(page, 'settings-list');
  await list.hover();
  for (let n = 0; n < 12 && !(await page.getByTestId(id).count()); n++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150); // 让虚拟列表处理真实滚轮事件并挂载下一段。
  }
  await (await unique(page, id)).click();
}

test('SETTINGS-004：客服、常见问题与各平台下载帮助浏览', async ({ page, signedInAccount }) => {
  test.setTimeout(180_000);
  await test.step('登录并打开我的', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'settings-tab')).click();
  });
  await test.step('从联系客服进入常见问题，并查看分享图文说明', async () => {
    await openSetting(page, 'contact-us');
    await expect(await unique(page, 'online-service-button')).toHaveText('在线客服');
    await expect(await unique(page, 'feedback-button')).toHaveText('问题反馈');
    await (await unique(page, 'faq-button')).click();
    await expect(await unique(page, 'faq-screen')).toContainText('如何创建自己的牌局？');
    await expect(await unique(page, 'faq-item-share_laiwan')).toHaveText('分享『来玩』');
    await (await unique(page, 'faq-item-share_laiwan')).click();
    await expect(await unique(page, 'faq-detail-scroll-view')).toBeVisible();
    await expect(await unique(page, 'faq-detail-image')).toBeVisible();
    await goBack(page);
    await expect(await unique(page, 'faq-item-share_laiwan')).toHaveText('分享『来玩』');
    await goBack(page);
    await expect(await unique(page, 'online-service-button')).toHaveText('在线客服');
    await goBack(page);
  });
  await test.step('浏览苹果下载帮助后返回平台列表', async () => {
    await openSetting(page, 'download-help');
    await expect(await unique(page, 'download-help-list')).toContainText('苹果下载帮助');
    await (await unique(page, 'apple-button')).click();
    await expect(await unique(page, 'apple_id_site_button')).toHaveText('https://appleid.apple.com/');
    await expect(await unique(page, 'h5_link1_button')).toBeVisible();
    await goBack(page);
    await expect(await unique(page, 'download-help-list')).toContainText('安卓下载帮助');
  });
  for (const [button, screen, content] of [
    ['android-button', 'download-android-help-view', '在安卓手机上找到Play商店'],
    ['h5-button', 'h5-version-help-view', '链接在任何电脑、手机、平板上都可以使用'],
    ['official_website-button', 'download-official-website-help-view', '找到本地下载按钮'],
  ]) {
    await test.step(`浏览${button}说明并返回`, async () => {
      await (await unique(page, button)).click();
      await expect(await unique(page, screen)).toContainText(content);
      await goBack(page);
      await expect(await unique(page, button)).toBeVisible();
    });
  }
});
