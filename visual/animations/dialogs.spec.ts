import { expect, test } from '@playwright/test';
import { buildScenarios } from '../scenarios';
import { setupContextForScenario } from '../src/support/pageSetup';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { navigate, openApplication, press, pressTarget, recordApplicationBuild, visible } from './appSession';
import { exercisePopup } from './popups';
import { appearance, captureTimeline, CLOCK_START } from './timeline';

test('staging notice fades and scales in on launch', async ({ context, page }, info) => {
  const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SUITE: 'app' })
    .find(item => item.pageLabel === 'hall' && item.viewport.label === info.project.name)!;
  await setupContextForScenario(context, scenario, page, { animations: 'allow' });
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await recordApplicationBuild(page, info);
  const dialog = page.getByTestId('staging-dialog');
  const title = page.getByTestId('staging-dialog-title');
  await expect(title).toBeAttached({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ensureLocalImagesLoaded(page);
  expect((await appearance(title))[0].opacity).toBe(0);
  await captureTimeline(page, info, 'staging-notice-enter', title,
    { times: [0, 80, 160, 320, 500, 800], requireMotion: true });
  expect((await appearance(title))[0].opacity).toBe(1);
  const input = dialog.locator('input').first();
  await input.fill((await input.getAttribute('placeholder'))!);
  await pressTarget(dialog.getByTestId('confirm-button'));
  // 确认会进入主导航并卸载启动页，不将整个页面切换伪称为弹窗退场动画。
  await page.clock.resume();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('hall-screen')).toBeVisible({ timeout: 60_000 });
});

test('share link confirmation dialog enter and exit', async ({ context, page }, info) => {
  await openApplication(context, page, info);
  await navigate(page, 'settings-tab');
  // “分享来玩”在设置列表下方，准备阶段用正常点击自动滚动到入口。
  await visible(page, 'share-app').click();
  await expect(visible(page, 'share-button')).toBeVisible();
  await exercisePopup(page, info, { name: 'share-link-confirmation', target: page.getByTestId('share-app-content'),
    clip: { x: 0, y: 0, ...page.viewportSize()! },
    open: /** 复制到当前测试浏览器的剪贴板并打开确认框。 */ () => press(page, 'share-button'),
    close: /** 关闭真实 Dialog。 */ () => press(page, 'confirm-button') });
});
