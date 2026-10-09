import { expect, test } from '../_shared/read-account-fixture';
import { goBack } from '../_shared/navigation';
import { unique } from '../_shared/page';
import { openSettings } from '../_shared/settings-navigation';

test('CLUB-006：纯空格地区和清空名称禁用完成', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await openSettings(page, 'create-club');
  const submit = await unique(page, 'edit-club-header-right-complete');
  const name = page.getByRole('textbox', { name: '请输入俱乐部名称', exact: true });
  const region = page.getByRole('textbox', { name: '请输入当前地区', exact: true });
  await expect(name).toHaveCount(1);
  await expect(region).toHaveCount(1);
  await test.step('有效表单改为纯空格地区后禁用，再恢复', async () => {
    await name.fill('E2E取消创建');
    await region.fill('测试地区');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await region.fill('   ');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await region.fill('测试地区');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  });
  await test.step('清空名称后禁用，取消返回我的页面', async () => {
    await name.clear();
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await goBack(page);
    await expect(await unique(page, 'settings-screen')).toBeVisible();
  });
});
