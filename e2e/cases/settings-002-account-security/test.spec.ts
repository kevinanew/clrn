import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';

test('SETTINGS-002：浏览账号安全四个分支并安全返回', async ({ page, signedInAccount }) => {
  await test.step('登录并进入账号与安全', async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'settings-tab')).click();
    await (await unique(page, 'account-security')).click();
    await expect(await unique(page, 'account-security-items-list')).toContainText('绑定手机号');
  });
  await test.step('浏览绑定手机，确认区号和空表单后返回', async () => {
    await (await unique(page, 'account-security-item-0')).click();
    await expect(await unique(page, 'country-code-text')).toHaveText(/^\+\d+$/);
    await expect(await unique(page, 'phone-number-input')).toHaveValue('');
    await goBack(page);
    await expect(await unique(page, 'account-security-item-0')).toHaveText('绑定手机号');
  });
  await test.step('浏览绑定邮箱说明后返回', async () => {
    await (await unique(page, 'account-security-item-1')).click();
    await expect(await unique(page, 'email-address-input')).toHaveValue('');
    await expect(await unique(page, 'bind-email-tips')).toContainText('账号登录、安全验证、修改密码');
    await goBack(page);
  });
  await test.step('浏览改密空表单后返回', async () => {
    await (await unique(page, 'account-security-item-2')).click();
    for (const id of ['old-password-input', 'new-password-input']) {
      await expect(await unique(page, id)).toHaveValue('');
      await expect(await unique(page, id)).toHaveAttribute('type', 'password');
    }
    await goBack(page);
  });
  await test.step('阅读注销影响并选择暂不注销', async () => {
    await (await unique(page, 'account-security-item-3')).click();
    await expect(await unique(page, 'explanation-text')).toHaveText('以下信息将被清空且无法找回');
    await expect(await unique(page, 'all-clubs-and-rooms-text')).toHaveText('所有俱乐部和房间');
    await (await unique(page, 'cancel-button')).click();
    await expect(await unique(page, 'account-security-items-list')).toContainText('修改密码');
  });
});
