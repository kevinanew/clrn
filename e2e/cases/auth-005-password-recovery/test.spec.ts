import { expect, test } from '@playwright/test';
import { openHall, openLoginForm, prepareContext, unique } from '../_shared/page';

for (const method of ['email', 'sms'] as const) {
  test(`AUTH-005：${method === 'email' ? '邮箱' : '短信'}找回密码表单可填写并返回`, async ({ page, context }) => {
    await test.step('从用户名登录进入找回密码方式选择', async () => {
      await prepareContext(context);
      await openHall(page);
      await openLoginForm(page);
      await (await unique(page, 'forget-password-button')).click();
      await expect(await unique(page, 'reset-password-by-email-button')).toBeVisible();
      await expect(await unique(page, 'reset-password-by-sms-button')).toBeVisible();
    });
    await test.step('填写找回密码联系方式，不发送验证码', async () => {
      await (await unique(page, `reset-password-by-${method}-button`)).click();
      await expect(await unique(page, 'greeting-text')).toHaveText('找回密码');
      const field = await unique(page, method === 'email' ? 'email-address-input' : 'phone-number-input');
      const value = method === 'email' ? 'e2e-form@example.invalid' : '2025550123';
      await field.fill(value);
      await expect(field).toHaveValue(value);
      await expect(await unique(page, 'next-button')).toHaveText('下一步');
    });
    await test.step('返回方式选择和用户名登录', async () => {
      await (await unique(page, 'back-button')).click();
      await expect(await unique(page, 'reset-password-by-email-button')).toBeVisible();
      await (await unique(page, 'back-button')).click();
      await expect(await unique(page, 'username-input')).toBeVisible();
      await expect(await unique(page, 'password-input')).toHaveAttribute('type', 'password');
    });
  });
}
