import { expect, test } from '../_shared/read-account-fixture';
import { goBack } from '../_shared/navigation';
import { unique } from '../_shared/page';
import { clickAfterSignInNotices } from '../_shared/sign-in-notices';

test('MESSAGE-002：带入通知切换未处理和已处理状态', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await clickAfterSignInNotices(page, 'message-tab');
  await (await unique(page, 'message-notification-item-buy-in')).click();
  const pending = page.getByRole('tab', { name: '未处理', exact: true });
  const processed = page.getByRole('tab', { name: '已处理', exact: true });
  await expect(pending).toHaveCount(1);
  await expect(processed).toHaveCount(1);
  await test.step('初始未处理选中，切至已处理后两者状态互斥', async () => {
    await expect(pending).toHaveAttribute('aria-selected', 'true');
    await processed.click();
    await expect(processed).toHaveAttribute('aria-selected', 'true');
    await expect(pending).toHaveAttribute('aria-selected', 'false');
  });
  await test.step('切回未处理并返回消息分类列表', async () => {
    await pending.click();
    await expect(pending).toHaveAttribute('aria-selected', 'true');
    await expect(processed).toHaveAttribute('aria-selected', 'false');
    await goBack(page);
    await expect(await unique(page, 'message-notification-item-buy-in')).toBeVisible();
  });
});
