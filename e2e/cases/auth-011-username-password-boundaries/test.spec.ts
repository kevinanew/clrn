import { expect, test } from '@playwright/test';
import { formInput } from '../_shared/form';
import { openHall, openLoginForm, prepareContext, unique } from '../_shared/page';

test('AUTH-011：用户名规范化、最短长度和密码上限', async ({ page, context }) => {
  await prepareContext(context);
  await openHall(page);
  await openLoginForm(page);
  const username = await formInput(page, 'username-input');
  const password = await formInput(page, 'password-input');
  const submit = await unique(page, 'sign-in-button');
  await test.step('用户名去除两端空格并转换小写', async () => {
    await username.fill(' LAIWANVISUAL01 ');
    await password.fill('validate1234');
    await expect(username).toHaveValue('laiwanvisual01');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  });
  await test.step('五位用户名无效，六位用户名有效', async () => {
    await username.fill('short');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
    await username.fill('sixchr');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  });
  await test.step('十九位密码有效，二十位密码无效', async () => {
    await username.fill('laiwanvisual01');
    await password.fill('1234567890123456789');
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    await password.fill('12345678901234567890');
    await expect(submit).toHaveAttribute('aria-disabled', 'true');
  });
});
