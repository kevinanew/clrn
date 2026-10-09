import { expect, test } from '@playwright/test';
import { goBack } from '../_shared/navigation';
import { openHall, prepareContext, unique } from '../_shared/page';
import { openSettings } from '../_shared/settings-navigation';

test('SETTINGS-008：语言预览后取消恢复已保存语言', async ({ page, context }) => {
  await prepareContext(context);
  await openHall(page);
  await openSettings(page, 'application-management');
  await (await unique(page, 'language')).click();
  await test.step('选择英文后立即显示英文预览和选中标记', async () => {
    await (await unique(page, 'english')).click();
    await expect(page.getByRole('heading', { name: 'Language', exact: true })).toBeVisible();
    await expect((await unique(page, 'english')).getByTestId('checkmark-icon')).toBeVisible();
  });
  await test.step('返回取消，再次打开仍选中简中且显示中文', async () => {
    await goBack(page);
    await (await unique(page, 'language')).click();
    await expect((await unique(page, 'zh-hans')).getByTestId('checkmark-icon')).toBeVisible();
    await expect(page.getByRole('heading', { name: '语言', exact: true })).toBeVisible();
  });
});
