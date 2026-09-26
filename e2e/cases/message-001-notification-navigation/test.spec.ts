import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';

test('MESSAGE-001：浏览三类消息并返回消息列表', async ({ page, signedInAccount }) => {
  await test.step('登录并打开消息列表', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'message-tab')).click();
    await expect(await unique(page, 'message-top-title')).toHaveText('消息');
  });
  const branches = [
    ['club', '俱乐部消息', 'club-notification-screen', 'no-notification-text', '还没有收到俱乐部通知'],
    ['buy-in', '带入消息', 'game-buy-in-application-list-screen', 'empty-page-text', '牌局消息已经全部处理'],
    ['system', '系统通知', 'system-notification-screen-root', 'no-notification-text', '还没有收到系统通知'],
  ];
  for (const [kind, label, screen, content, emptyText] of branches) {
    await test.step(`打开${label}、确认空态并返回`, async () => {
      const entry = await unique(page, `message-notification-item-${kind}`);
      await expect(entry).toHaveText(label);
      await entry.click();
      await expect(await unique(page, screen)).toBeVisible();
      await expect(await unique(page, content)).toHaveText(emptyText);
      await goBack(page);
      await expect(await unique(page, 'message-top-title')).toHaveText('消息');
      await expect(await unique(page, `message-notification-item-${kind}`)).toBeVisible();
    });
  }
  await test.step('从我的再次进入俱乐部消息并返回', async () => {
    await (await unique(page, 'settings-tab')).click();
    await (await unique(page, 'club-notifications')).click();
    await expect(await unique(page, 'no-notification-text')).toHaveText('还没有收到俱乐部通知');
    await goBack(page);
    await expect(await unique(page, 'club-notifications')).toHaveText('俱乐部消息');
  });
});
