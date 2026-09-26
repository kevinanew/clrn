import { expect, test } from '@playwright/test';
import { openHall, prepareContext, unique } from '../_shared/page';

test('AUTH-004：手机号登录选择国家区号并切换密码方式', async ({ page, context }) => {
  await test.step('打开游客手机号登录表单', async () => {
    await prepareContext(context);
    await openHall(page);
    await (await unique(page, 'hall-sign-in-button')).click();
    await (await unique(page, 'sign-in-button')).click();
    await expect(await unique(page, 'country-code-selector')).toContainText('+86');
  });
  await test.step('选择中国香港区号并确认表单回填', async () => {
    await (await unique(page, 'country-code-selector')).click();
    await expect(await unique(page, 'pick-country-code-container')).toBeVisible();
    await (await unique(page, 'country-code-list-item-852')).click();
    await expect(await unique(page, 'country-code-selector')).toContainText('中国香港');
    await expect(await unique(page, 'country-code-selector')).toContainText('+852');
    await (await unique(page, 'phone-number-input')).fill('2025550123');
    await expect(await unique(page, 'phone-number-input')).toHaveValue('2025550123');
    await expect(await unique(page, 'sms-request-code-button')).toHaveText('登录或注册');
  });
  await test.step('切换密码登录并确认密码遮蔽，不提交', async () => {
    await (await unique(page, 'password-sign-in-button')).click();
    const password = (await unique(page, 'password-input')).locator('input');
    await expect(password).toHaveCount(1);
    await expect(password).toHaveAttribute('type', 'password');
    await password.fill('formcheck123');
    await expect(password).toHaveValue('formcheck123');
    await (await unique(page, 'phone-number-input')).fill('2025550123');
    await expect(await unique(page, 'phone-number-input')).toHaveValue('2025550123');
  });
});
