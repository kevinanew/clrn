import { expect, test } from '../src/support/networkFixture';
import { buildScenarios } from '../scenarios';
import { setupContextForScenario } from '../src/support/pageSetup';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { openApplication, recordApplicationBuild } from './appSession';
import { appearance, captureTimeline, CLOCK_START, fixedArea, freeze } from './timeline';
import { prepareSlotBannerTimeline } from './slotBannerPreparation';

test('launch branding fades in', /** 验证启动品牌标识的淡入动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ context, page }, info) => {
  const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SUITE: 'app' })
    .find(/** 查找满足以下条件的首个条目：`item.pageLabel === 'hall' && item.viewport.label === info.project.name`。
 * @param item - 当前遍历的条目。 */ item => item.pageLabel === 'hall' && item.viewport.label === info.project.name)!;
  await setupContextForScenario(context, scenario, page, { animations: 'allow' });
  await page.clock.install({ time: CLOCK_START });
  // 页面尚未导航，先在未来暂停；install 与 pauseAt 之间的协议耗时不能造成“回到过去”。
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await recordApplicationBuild(page, info);
  const branding = page.getByTestId('launch-brand-name');
  await expect(branding).toBeAttached({ timeout: 60_000 });
  await page.evaluate(/** 在页面中读取`document.fonts.ready.then(() => undefined)`，供测试判断当前界面状态。 */ () => document.fonts.ready.then(/** 将异步结果转换为`undefined`，供后续步骤使用。 */ () => undefined));
  await ensureLocalImagesLoaded(page);
  expect((await appearance(branding))[0].opacity).toBe(0);
  await captureTimeline(page, info, 'launch-branding', branding,
    { clip: await fixedArea(page, branding.locator('..')), times: [0, 80, 160, 320, 500, 800] });
  expect((await appearance(branding))[0].opacity).toBe(1);
});

test('大厅老虎机横幅自动旋转并重复', /** 验证大厅老虎机横幅自动旋转并重复。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ context, page }, info) => {
  await context.addInitScript(/** 固定动画场景的随机输入，使截图中的随机行为可复现。 */ () => { Math.random = /** 固定本场景的随机输入。 */ () => 0.37; });
  await openApplication(context, page, info, 'hall');
  const banner = page.getByTestId('slot-banner');
  await expect(banner).toBeVisible();
  const clip = await fixedArea(page, banner, 0);
  await freeze(page);
  // 基准从快进终点触发的真实旋转开始采样，不能再等待下一轮，否则图标序列会错位。
  await prepareSlotBannerTimeline(page);
  await captureTimeline(page, info, 'hall-slot-banner', banner,
    { clip, times: [0, 160, 500, 1000, 1200, 4000, 4500, 5200] });
});
