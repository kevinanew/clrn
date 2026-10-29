import { selectScenario, scenarioStatus } from '../../../e2e/helpers/scenario-proxy';
import { expect, test } from '../../src/support/networkFixture';
import { PNG } from 'pngjs';
import { buildScenarios } from '../../scenarios';
import { setupContextForScenario } from '../../src/support/pageSetup';
import { ensureLocalImagesLoaded } from '../../src/support/pageStabilizers';
import { pressTarget, recordApplicationBuild } from '../../animations/appSession';
import { CLOCK_START } from '../../animations/timeline';

for (const scenario of buildScenarios().filter(item => item.group === 'launch')) {
  test(scenario.label, async ({ page, context }, info) => {
    await page.setViewportSize(scenario.viewport);
    await setupContextForScenario(context, scenario, page, { animations: 'allow',
      navigatorLocale: { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', en: 'en-US' }[scenario.locale] });
    // 延迟真实启动依赖的网络响应，让确认提示后的加载页有稳定采样窗口。
    // 不删除弹窗、覆盖业务组件或修改页面样式；保留真实点击和初始化等待。
    await selectScenario(context, 'launch', { phase: 'hold' });
    try {
      await page.clock.install({ time: CLOCK_START });
      await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await recordApplicationBuild(page, info);
      const launch = page.getByTestId('launch-screen-container');
      const dialog = page.getByTestId('staging-dialog');
      const brand = page.getByTestId('launch-brand-name');
      await expect(dialog).toBeAttached({ timeout: 60_000 });
      await expect(launch).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await ensureLocalImagesLoaded(page);
      await page.clock.runFor(800);
      await expect(brand.locator('..')).toHaveCSS('opacity', '1');
      await expect(brand).toHaveText({ 'zh-Hans': '来玩', 'zh-Hant': '來玩', en: 'GoPlay360' }[scenario.locale]);
      await expect(dialog.getByTestId('staging-dialog-title')).toBeVisible();
      if (scenario.pageLabel === 'launch_branding') {
        await expect.poll(async () => (await scenarioStatus(context)).held, { message: '启动网络必须仍在等待响应' }).toBeGreaterThan(0);
        const input = dialog.locator('input').first();
        await input.fill((await input.getAttribute('placeholder'))!);
        await pressTarget(dialog.getByTestId('confirm-button'));
        await page.clock.runFor(800);
        await expect(dialog).toBeHidden();
        await expect(launch).toBeVisible();
        await expect(page.getByTestId('hall-screen')).toBeHidden();
      }
      await ensureLocalImagesLoaded(page);
      const options = { fullPage: false, animations: 'allow' as const, caret: 'hide' as const, scale: 'css' as const };
      const buffer = await page.screenshot(options);
      await info.attach('complete-startup-page', { body: buffer, contentType: 'image/png' });
      await expect(page).toHaveScreenshot(`${scenario.label}.png`, options);
      const screenshot = PNG.sync.read(buffer);
      expect([screenshot.width, screenshot.height], '保留完整视口，不裁切、不遮罩').toEqual([
        scenario.viewport.width, scenario.viewport.height,
      ]);
      // 释放真实网络流程后必须能够进入大厅，证明采样没有替换初始化逻辑。
      if (scenario.pageLabel === 'launch_staging_notice') {
        const input = dialog.locator('input').first();
        await input.fill((await input.getAttribute('placeholder'))!);
        await pressTarget(dialog.getByTestId('confirm-button'));
      }
      await selectScenario(context, 'launch', { phase: 'release' });
      await page.clock.resume();
      await expect(page.getByTestId('hall-screen')).toBeVisible({ timeout: 60_000 });
    } finally {
      await selectScenario(context, 'launch', { phase: 'release' });
    }
  });
}
