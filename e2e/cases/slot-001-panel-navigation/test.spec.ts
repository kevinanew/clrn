import { test, expect } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { readDiamondBalance } from '../_shared/provision';

test('SLOT-001：抽奖面板显示能量和奖品，关闭重开不消耗钻石', async ({ page, signedInAccount }) => {
  const before = await readDiamondBalance(page, signedInAccount);
  for (let visit = 0; visit < 2; visit++) {
    await test.step(`第 ${visit + 1} 次打开和关闭抽奖面板`, async () => {
      await (await unique(page, 'slot-banner')).click();
      const panel = await unique(page, 'slot-machine-view');
      await expect(panel.getByTestId('energy-bar-text')).toHaveText(/^\d+\s*\/\s*\d+$/);
      for (const currency of ['coin', 'diamond', 'energy']) {
        await expect(panel.getByTestId(`prize_${currency}_text_animation_text`)).toHaveText('0');
      }
      await expect(panel.getByTestId('spin-button')).toBeVisible();
      await panel.getByTestId('close-button').click();
      await expect(panel).not.toBeVisible();
      await expect(await unique(page, 'hall-auth-state-signed-in')).toBeVisible();
    });
  }
  expect(await readDiamondBalance(page, signedInAccount)).toBe(before);
});
