import { test, expect } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { readDiamondBalance } from '../_shared/provision';

for (const game of [
  { name: '经典德州', id: 'texas_react_native', rule: 'small-big-blind-title-text', text: '小盲 / 大盲' },
  { name: '拼三张', id: 'zhajinhua', rule: 'pin-san-zhang-rule-title-text', text: '拼三张规则' },
  { name: '短牌', id: 'texas_six_plus', rule: 'six-plus-rule-title-text', text: '短牌规则' },
]) {
  test(`${game.name}配置可编辑、展开高级设置并返回`, async ({ page, signedInAccount }) => {
    const before = await readDiamondBalance(page, signedInAccount);
    await test.step('从私人房间选择玩法', async () => {
      await (await unique(page, 'private-room-tab')).click();
      await (await unique(page, 'create-game-button')).click();
      await expect(await unique(page, 'select-game-category-text')).toBeVisible();
      await (await unique(page, `game-type-button-${game.id}`)).click();
      await expect(await unique(page, 'base-create-room-screen')).toBeVisible();
    });
    await test.step('验证玩法配置并展开高级设置', async () => {
      await expect(await unique(page, game.rule)).toHaveText(game.text);
      const input = await unique(page, 'room-name-input');
      await input.fill(`E2E${game.name}`);
      await expect(input).toHaveValue(`E2E${game.name}`);
      await expect(await unique(page, 'chip-item-text')).toHaveText('记分牌');
      await expect(await unique(page, 'price-text')).toHaveText('10');
      await (await unique(page, 'advanced-options-button')).click();
      await expect(await unique(page, 'operation-duration-title-text')).toHaveText('回合时长(30秒)');
    });
    await test.step('返回私人房间，不创建牌局或消耗钻石', async () => {
      await (await unique(page, 'navigation-bar-back-image')).click();
      await expect(await unique(page, 'create-game-button')).toBeVisible();
      await expect(page.getByTestId(/^private-room-[0-9a-f-]{36}$/).filter({ visible: true })).toHaveCount(0);
      expect(await readDiamondBalance(page, signedInAccount)).toBe(before);
    });
  });
}
