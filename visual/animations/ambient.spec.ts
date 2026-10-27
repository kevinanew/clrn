import { expect, test } from '@playwright/test';
import { buildScenarios } from '../scenarios';
import { setupContextForScenario } from '../src/support/pageSetup';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { openApplication, recordApplicationBuild } from './appSession';
import { appearance, captureTimeline, CLOCK_START, fixedArea, freeze } from './timeline';

test('launch branding fades in', async ({ context, page }, info) => {
  const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SUITE: 'app' })
    .find(item => item.pageLabel === 'hall' && item.viewport.label === info.project.name)!;
  await setupContextForScenario(context, scenario, page, { animations: 'allow' });
  await page.clock.install({ time: CLOCK_START });
  // 页面尚未导航，先在未来暂停；install 与 pauseAt 之间的协议耗时不能造成“回到过去”。
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await recordApplicationBuild(page, info);
  const branding = page.getByTestId('launch-brand-name');
  await expect(branding).toBeAttached({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ensureLocalImagesLoaded(page);
  expect((await appearance(branding))[0].opacity).toBe(0);
  await captureTimeline(page, info, 'launch-branding', branding,
    { clip: await fixedArea(page, branding.locator('..')), times: [0, 80, 160, 320, 500, 800] });
  expect((await appearance(branding))[0].opacity).toBe(1);
});

test('大厅老虎机横幅自动旋转并重复', async ({ context, page }, info) => {
  await context.addInitScript(() => { Math.random = /** 固定本场景的随机输入。 */ () => 0.37; });
  await openApplication(context, page, info, 'hall');
  const banner = page.getByTestId('slot-banner');
  await expect(banner).toBeVisible();
  const clip = await fixedArea(page, banner, 0);
  await freeze(page);
  // 基准从快进终点触发的真实旋转开始采样，不能再等待下一轮，否则图标序列会错位。
  await page.clock.fastForward(12_000);
  await captureTimeline(page, info, 'hall-slot-banner', banner,
    { clip, times: [0, 160, 500, 1000, 1200, 4000, 4500, 5200] });
});
