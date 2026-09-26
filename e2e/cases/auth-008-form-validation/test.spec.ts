import { expect, test } from '@playwright/test';
import { openHall, openLoginForm, prepareContext, unique } from '../_shared/page';

test('AUTH-008：登录必填与密码长度校验随输入、清空即时更新', async ({ page, context }) => {
  await prepareContext(context);
  await openHall(page);
  await openLoginForm(page);
  const username = await unique(page, 'username-input');
  const password = await unique(page, 'password-input');
  const submit = await unique(page, 'sign-in-button');
  await test.step('空表单和短密码不能提交', async () => {
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await username.fill('formcheck');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await password.fill('123456');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
  });
  await test.step('有效输入启用提交，清空任一必填项再次禁用', async () => {
    await password.fill('formcheck123');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await username.clear();
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await username.fill('formcheck');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await password.clear();
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
  });
});

test('AUTH-008：找回密码拒绝空邮箱和无效格式，修改后恢复', async ({ page, context }) => {
  await prepareContext(context);
  await openHall(page);
  await openLoginForm(page);
  await (await unique(page, 'forget-password-button')).click();
  await (await unique(page, 'reset-password-by-email-button')).click();
  const email = await unique(page, 'email-address-input');
  const next = await unique(page, 'next-button');
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  for (const invalid of ['bad-email', 'name@', '@example.invalid']) {
    await email.fill(invalid);
    await expect(next, `无效邮箱 ${invalid} 不允许进入下一步`).toHaveAttribute('aria-disabled', 'true');
  }
  await email.fill('formcheck@example.invalid');
  await expect(next).not.toHaveAttribute('aria-disabled', 'true');
  await email.clear();
  await expect(next).toHaveAttribute('aria-disabled', 'true');
});
