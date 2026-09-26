import { expect, test } from '@playwright/test';
import { openHall, prepareContext, unique } from '../_shared/page';

for (const [tab, screen] of [['club-tab', 'club-tab-screen'], ['message-tab', 'message-screen']] as const) {
  test(`HALL-002：游客 ${tab} 空态可进入登录`, async ({ page, context }) => {
    await test.step('打开游客功能入口', async () => {
      await prepareContext(context);
      await openHall(page);
      await (await unique(page, tab)).click();
      await expect(await unique(page, screen)).toBeVisible();
    });
    await test.step('点击游客引导并验证登录选项', async () => {
      await (await unique(page, 'not-sign-in-container')).click();
      await expect(await unique(page, 'username-or-email-sign-in-button')).toBeVisible();
    });
  });
}

test('HALL-002：游客我的页面隐藏资产并提供登录入口', async ({ page, context }) => {
  await test.step('打开我的页面并检查游客资产提示', async () => {
    await prepareContext(context);
    await openHall(page);
    await (await unique(page, 'settings-tab')).click();
    await expect(await unique(page, 'after-sign-in-see-asset-text')).toHaveText('登录后可查看钻石金币余额');
  });
  await test.step('打开登录方式选择', async () => {
    await (await unique(page, 'sign-in-button')).click();
    await expect(await unique(page, 'username-or-email-sign-in-button')).toBeVisible();
  });
});

test('HALL-002：游客搜索提示可取消，也可前往登录', async ({ page, context }) => {
  await test.step('打开搜索登录门禁', async () => {
    await prepareContext(context);
    await openHall(page);
    await (await unique(page, 'hall-search-button')).click();
    await expect(await unique(page, 'pop-up-message-text')).toHaveText('请先登录以使用搜索功能');
  });
  await test.step('取消后保持游客状态', async () => {
    await (await unique(page, 'cancel-button')).click();
    await expect(page.getByTestId('confirm-pop-up-image-background')).toBeHidden();
    await expect(await unique(page, 'hall-auth-state-signed-out')).toBeVisible();
  });
  await test.step('再次搜索并确认登录', async () => {
    await (await unique(page, 'hall-search-button')).click();
    await (await unique(page, 'confirm-button')).click();
    await expect(await unique(page, 'username-or-email-sign-in-button')).toBeVisible();
  });
});

for (const game of ['texas_holdem', 'zhajinhua']) {
  test(`HALL-002：游客 ${game} 入场需登录且可关闭`, async ({ page, context }) => {
    await test.step('等待场次数据并打开游客场', async () => {
      await prepareContext(context);
      await openHall(page);
      await (await unique(page, `match-game-item-${game}-tourists`)).click();
      await expect(await unique(page, 'game-matching-sign-in-popup')).toBeVisible();
      await expect(await unique(page, 'pop-up-message-text')).toHaveText('请登录后加入游戏');
    });
    await test.step('关闭弹窗，保持游客大厅', async () => {
      await (await unique(page, 'close-button')).click();
      await expect(page.getByTestId('game-matching-sign-in-popup')).toBeHidden();
      await expect(await unique(page, 'hall-auth-state-signed-out')).toBeVisible();
    });
  });
}
