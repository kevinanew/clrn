import { expect, test } from '../_shared/read-account-fixture';
import { goBack } from '../_shared/navigation';
import { unique } from '../_shared/page';
import { clickAfterSignInNotices } from '../_shared/sign-in-notices';

for (const game of [
  { id: 'texas_react_native', title: '德州扑克' },
  { id: 'zhajinhua', title: '拼三张' },
  { id: 'texas_six_plus', title: '德州短牌' },
]) {
  test(`PRIVATE-005：${game.title}带入审核切换后恢复初始值`, async ({ page, signedInAccount }) => {
    expect(signedInAccount.userId).toBeTruthy();
    await test.step('从私人房选择玩法，等待建房表单和弹层关闭', async () => {
      await clickAfterSignInNotices(page, 'private-room-tab');
      await expect(await unique(page, 'copy-house-number-button')).toContainText(/\d{9}/);
      const selector = page.getByTestId('select-game-category-text');
      if (!(await selector.isVisible())) await (await unique(page, 'create-game-button')).click();
      await (await unique(page, `game-type-button-${game.id}`)).click();
      await expect(selector).toBeHidden();
      await expect(page.getByRole('button', { name: 'Bottom sheet backdrop', exact: true })).toBeHidden();
      await expect(await unique(page, 'base-create-room-screen')).toBeVisible();
    });
    await test.step('审核开关切换为反值，再恢复进入页面时的值', async () => {
      const audit = (await unique(page, 'audit-buy-in-switch')).getByRole('switch');
      await expect(audit).toHaveCount(1);
      const wasChecked = await audit.isChecked();
      await audit.click();
      await expect(audit).toBeChecked({ checked: !wasChecked });
      await audit.click();
      await expect(audit).toBeChecked({ checked: wasChecked });
    });
    await test.step('取消返回，不创建牌局', async () => {
      await goBack(page);
      await expect(await unique(page, 'create-game-button')).toBeVisible();
      await expect(page.getByTestId('base-create-room-screen')).toBeHidden();
    });
  });
}
