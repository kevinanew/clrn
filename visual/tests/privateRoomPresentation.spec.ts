import { test, expect } from '@playwright/test';
import { buildScenarios } from '../scenarios';
import { privateRoomPresentationRules } from '../cases/private-room/presentation';
import { applyContentStabilizers } from '../src/support/pageStabilizers';

test('私人房号只稳定展示文字并保留三语言标签、图标和复制行为', async ({ page }) => {
  const scenario = buildScenarios({ VISUAL_SUITE: 'app', VISUAL_LOCALES: 'zh-Hant' })
    .find(item => item.pageLabel === 'signed_in_private_room_join')!;
  for (const label of ['房间号', '房間號', 'Room number']) {
    await page.setContent(`<button data-testid="copy-house-number-button" onclick="this.dataset.copied='523204023'">
      <div><div dir="auto">${label}: 523204023</div><div data-testid="复制图标"></div></div></button>`);
    await applyContentStabilizers(page, { ...scenario,
      fixedTexts: await privateRoomPresentationRules(page, scenario) });
    await expect(page.getByTestId('copy-house-number-button')).toHaveText(`${label}: 123456789`);
    await expect(page.getByTestId('复制图标')).toHaveCount(1);
    await page.getByTestId('copy-house-number-button').click();
    await expect(page.getByTestId('copy-house-number-button')).toHaveAttribute('data-copied', '523204023');
    await page.locator('[dir="auto"]').evaluate(node => { node.textContent = '重绘后的房号: 987654321'; });
    await expect(page.getByTestId('copy-house-number-button')).toHaveText(`${label}: 123456789`);
  }
});

test('私人房资料未就绪时拒绝伪造房号，游客和其他场景保持原样', async ({ page }) => {
  const scenario = buildScenarios({ VISUAL_SUITE: 'app', VISUAL_LOCALES: 'zh-Hant' })
    .find(item => item.pageLabel === 'signed_in_private_room_join')!;
  await page.setContent('<button data-testid="copy-house-number-button"><div dir="auto">房間號: </div></button>');
  await expect(privateRoomPresentationRules(page, scenario)).rejects.toThrow('私人房页必须先显示真实的九位房号');
  expect(await privateRoomPresentationRules(page, { ...scenario, signIn: false })).toEqual([]);
  expect(await privateRoomPresentationRules(page, { ...scenario, group: 'hall' })).toEqual([]);
  await page.setContent('<div>建房表单没有房号标题</div>');
  expect(await privateRoomPresentationRules(page, scenario)).toEqual([]);
});
