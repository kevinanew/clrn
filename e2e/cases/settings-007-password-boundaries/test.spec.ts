import { expect, test } from '../_shared/read-account-fixture';
import { formInput } from '../_shared/form';
import { goBack } from '../_shared/navigation';
import { unique } from '../_shared/page';
import { openSettings } from '../_shared/settings-navigation';

test('SETTINGS-007：修改密码的八至十六位边界', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await openSettings(page, 'account-security');
  await (await unique(page, 'account-security-item-2')).click();
  const oldPassword = await formInput(page, 'old-password-input');
  const newPassword = await formInput(page, 'new-password-input');
  const confirm = await unique(page, 'confirm-button');
  await expect(confirm).toHaveAttribute('aria-disabled', 'true');
  await test.step('旧密码有效时验证新密码的七、八、十六、十七位', async () => {
    await oldPassword.fill('12345678');
    for (const [value, disabled] of [
      ['1234567', true], ['12345678', false],
      ['12345678901234567', true], ['1234567890123456', false],
    ] as const) {
      await newPassword.fill(value);
      if (disabled) await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      else await expect(confirm).not.toHaveAttribute('aria-disabled', 'true');
    }
  });
  await test.step('新密码有效时验证旧密码边界和清空状态', async () => {
    for (const [value, disabled] of [
      ['1234567', true], ['1234567890123456', false],
      ['12345678901234567', true], ['', true],
    ] as const) {
      await oldPassword.fill(value);
      if (disabled) await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      else await expect(confirm).not.toHaveAttribute('aria-disabled', 'true');
    }
  });
  await test.step('返回账号安全，不提交修改密码请求', async () => {
    await goBack(page);
    await expect(await unique(page, 'account-security-items-list')).toBeVisible();
  });
});
