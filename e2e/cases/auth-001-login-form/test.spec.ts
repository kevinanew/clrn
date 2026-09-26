import { expect, test } from '@playwright/test';
import { openHall, openLoginForm, prepareContext, unique } from '../_shared/page';

test('AUTH-001：打开用户名登录表单，密码输入被遮蔽', async ({ page, context }) => {
  await test.step('从游客大厅打开用户名登录', async () => {
    await prepareContext(context);
    await openHall(page);
    await openLoginForm(page);
  });
  await test.step('填写表单并检查密码遮蔽，不提交凭据', async () => {
    const username = await unique(page, 'username-input');
    const password = await unique(page, 'password-input');
    await username.fill('formcheck');
    await password.fill('formcheck123');
    await expect(username).toHaveValue('formcheck');
    await expect(password).toHaveValue('formcheck123');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(await unique(page, 'forget-password-button')).toBeVisible();
  });
});
