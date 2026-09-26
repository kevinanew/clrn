import { expect, test } from '@playwright/test';
import { buildScenarios } from '../scenarios';
import { buildStorageStateForScenario, setupContextForScenario } from '../src/support/pageSetup';
import { preparePage } from '../src/support/preparePage';

/**
 * 场景矩阵由 scenarios.ts 单一数据源生成：
 * 语言（VISUAL_LOCALES）× 视口 × 页面，label 形如 `zh-Hans_desktop_hall`。
 */
const scenarios = buildScenarios();
import { visualBaseUrl as baseUrl } from '../target';
const backAccessibilityLabels = {
  'zh-Hans': '返回',
  'zh-Hant': '返回',
  en: 'Back',
};

for (const scenario of scenarios) {
  test(scenario.label, async ({ browser }) => {
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
      if (scenario.pageLabel === 'signed_in_application_management') {
        const visibleBackButton = page
          .locator('[data-testid="navigation-bar-back-image"]:visible')
          .locator('xpath=ancestor::button[1]');
        await expect(visibleBackButton).toHaveCount(1);
        const accessibilityLabel = await visibleBackButton.getAttribute('aria-label');
        expect(accessibilityLabel).toBe(backAccessibilityLabels[scenario.locale]);
      }
      if (scenario.pageLabel === 'texas_holdem_flop' && scenario.viewport.label === 'mobile') {
        const nickname = page
          .locator('[data-testid="adaptable-text-web"]:visible', { hasText: '小雨' })
          .first();
        const action = page.locator('[data-testid="texas-holdem-player-action-raise"]:visible');
        await expect(nickname).toBeVisible();
        await expect(action).toBeVisible();

        const [nicknameBox, actionBox] = await Promise.all([
          nickname.boundingBox(),
          action.boundingBox(),
        ]);
        if (!nicknameBox || !actionBox) {
          throw new Error('移动端翻牌圈玩家昵称或动作提示缺少可见布局区域');
        }
        expect(actionBox.y).toBeGreaterThanOrEqual(nicknameBox.y + nicknameBox.height);
      }
      await expect(page).toHaveScreenshot(`${scenario.label}.png`);
    } finally {
      await context.close();
    }
  });
}
