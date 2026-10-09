import { expect, test } from '../_shared/read-account-fixture';
import { formInput } from '../_shared/form';
import { unique } from '../_shared/page';
import { clickAfterSignInNotices } from '../_shared/sign-in-notices';

test('PRIVATE-004：九位数字房号才启用加入，字母输入被拒绝', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await clickAfterSignInNotices(page, 'private-room-tab');
  const number = await formInput(page, 'personal-room-smooth-pin-code-input');
  const join = await unique(page, 'join-game-button');
  await test.step('空房号和八位房号禁用加入，九位启用', async () => {
    await expect(join).toHaveAttribute('aria-disabled', 'true');
    await number.fill('12345678');
    await expect(join).toHaveAttribute('aria-disabled', 'true');
    await number.fill('123456789');
    await expect(join).not.toHaveAttribute('aria-disabled', 'true');
  });
  await test.step('真实按键清空，输入字母后仍为空且禁用加入', async () => {
    await number.press('ControlOrMeta+A');
    await number.press('Backspace');
    await expect(number).toHaveValue('');
    await number.pressSequentially('abc');
    await expect(number).toHaveValue('');
    await expect(join).toHaveAttribute('aria-disabled', 'true');
  });
});
