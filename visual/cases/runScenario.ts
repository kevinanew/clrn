import { expect, type Browser } from '@playwright/test';
import type { VisualScenario } from '../scenarioTypes';
import { buildStorageStateForScenario, setupContextForScenario } from '../src/support/pageSetup';
import { preparePage } from '../src/support/preparePage';

import { visualBaseUrl as baseUrl } from '../target';
const backAccessibilityLabels = {
  'zh-Hans': '返回',
  'zh-Hant': '返回',
  en: 'Back',
};

/**
 * 为单个视觉场景创建隔离上下文，准备页面并执行截图后清理资源。
 * @param scenario - 本次执行的视觉配置或代理故障场景。
 * @param browser - 用于创建隔离上下文的浏览器实例。
 */
export async function runVisualScenario(scenario: VisualScenario, browser: Browser): Promise<void> {
    const context = await browser.newContext({
      viewport: { width: scenario.viewport.width, height: scenario.viewport.height },
      locale: 'en-US',
      deviceScaleFactor: 1,
      storageState: buildStorageStateForScenario(scenario, baseUrl),
    });
    const page = await context.newPage();

    try {
      await setupContextForScenario(context, scenario, page);
      await page.goto(scenario.path);
      await preparePage(page, scenario);
      if (scenario.spriteImageCount) {
        const sprites = page.locator('[data-testid="sprite-image-container"]');
        const spriteContents = page.locator('[data-testid="sprite-image-content"]');
        await expect(sprites).toHaveCount(scenario.spriteImageCount);
        await expect(spriteContents).toHaveCount(scenario.spriteImageCount);
        for (let index = 0; index < scenario.spriteImageCount; index += 1) {
          await expect(spriteContents.nth(index)).toHaveCSS('opacity', '1');
        }
      }
      // preparePage 内的稳定化步骤可能耗时较长。截图前再次断言就绪元素仍可见，
      // 避免「更多」菜单等短暂出现后又消失时，被空白页面静默写入视觉基准图。
      await expect(page.locator(`${scenario.visualReadySelector}:visible`).last()).toBeVisible();
      if (scenario.pageLabel === 'signed_in_daily_bonus') {
        await expect(page.getByTestId('CheckInDateListItem.checkInDetailDate')).toHaveText('01/01');
      }
      if (scenario.pageLabel === 'signed_in_application_management') {
        const visibleBackButton = page
          .locator('[data-testid="navigation-bar-back-image"]:visible')
          .locator('xpath=ancestor::button[1]');
        await expect(visibleBackButton).toHaveCount(1);
        const accessibilityLabel = await visibleBackButton.getAttribute('aria-label');
        expect(accessibilityLabel).toBe(backAccessibilityLabels[scenario.locale]);
      }
      await expect(page).toHaveScreenshot(`${scenario.label}.png`);
    } finally {
      await context.close();
    }
}
