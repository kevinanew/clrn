import { test, expect } from '../src/support/diagnosticTest';
import { buildScenarios } from '../scenarios';
import { privateRoomPresentationRules } from '../cases/private-room/presentation';
import { applyContentStabilizers } from '../src/support/pageStabilizers';

test('私人房号只稳定展示文字并保留三语言标签、图标和复制行为', /** 验证私人房号只稳定展示文字并保留三语言标签、图标和复制行为。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  const scenario = buildScenarios({ VISUAL_SUITE: 'app', VISUAL_LOCALES: 'zh-Hant' })
    .find(/** 定位加入私人房场景，核对房号输入页的展示配置。
 * @param item - 当前遍历的条目。 */ item => item.pageLabel === 'signed_in_private_room_join')!;
  for (const label of ['房间号', '房間號', 'Room number']) {
    await page.setContent(`<button data-testid="copy-house-number-button" onclick="this.dataset.copied='523204023'">
      <div><div dir="auto">${label}: 523204023</div><div data-testid="复制图标"></div></div></button>`);
    await applyContentStabilizers(page, { ...scenario,
      fixedTexts: await privateRoomPresentationRules(page, scenario) });
    await expect(page.getByTestId('copy-house-number-button')).toHaveText(`${label}: 123456789`);
    await expect(page.getByTestId('复制图标')).toHaveCount(1);
    await page.getByTestId('copy-house-number-button').click();
    await expect(page.getByTestId('copy-house-number-button')).toHaveAttribute('data-copied', '523204023');
    await page.locator('[dir="auto"]').evaluate(/** 模拟私人房号被 React 重绘，验证展示稳定化会重新应用。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => { node.textContent = '重绘后的房号: 987654321'; });
    await expect(page.getByTestId('copy-house-number-button')).toHaveText(`${label}: 123456789`);
  }
});

test('私人房资料未就绪时拒绝伪造房号，游客和其他场景保持原样', /** 验证私人房资料未就绪时拒绝伪造房号，游客和其他场景保持原样。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  const scenario = buildScenarios({ VISUAL_SUITE: 'app', VISUAL_LOCALES: 'zh-Hant' })
    .find(/** 定位加入私人房场景，验证布局准备不改变页面内容。
 * @param item - 当前遍历的条目。 */ item => item.pageLabel === 'signed_in_private_room_join')!;
  await page.setContent('<button data-testid="copy-house-number-button"><div dir="auto">房間號: </div></button>');
  await expect(privateRoomPresentationRules(page, scenario)).rejects.toThrow('私人房页必须先显示真实的九位房号');
  expect(await privateRoomPresentationRules(page, { ...scenario, signIn: false })).toEqual([]);
  expect(await privateRoomPresentationRules(page, { ...scenario, group: 'hall' })).toEqual([]);
  await page.setContent('<div>建房表单没有房号标题</div>');
  expect(await privateRoomPresentationRules(page, scenario)).toEqual([]);
});
