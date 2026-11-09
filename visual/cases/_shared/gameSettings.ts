/** 启用游戏设置开关，保留各游戏原有的时钟推进和勾选检查。 */
import { expect as playwrightExpect, type Locator, type Page } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 30_000 });

/**
 * 只点击未开启的设置；调用方决定点击后推进时钟及是否核对勾选状态。
 * @param page - 当前游戏页面。
 * @param options - 原场景的时钟推进和最终勾选断言配置。
 */
export async function enableGameSettings(page: Page, options: { afterClick?: () => Promise<void>; assertChecked: boolean }) {
  const switches = page.locator('[data-testid^="game-settings-switch-"]:visible');
  expect(await switches.count()).toBeGreaterThanOrEqual(4);
  for (const control of await switches.all()) {
    await enableUncheckedSetting(control, options.afterClick);
    if (options.assertChecked) await expect(control.locator('input[type="checkbox"]')).toBeChecked();
  }
}

/**
 * 已勾选时不再点击，只有真实点击之后才推进调用方时钟。
 * @param control - 当前设置控件。
 * @param afterClick - 原场景的点击后动作。
 */
async function enableUncheckedSetting(control: Locator, afterClick: (() => Promise<void>) | undefined) {
  if (await control.locator('input[type="checkbox"]').isChecked()) return;
  await control.click();
  await afterClick?.();
}
