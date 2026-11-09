import { expect, test } from '../src/support/networkFixture';
import { buildScenarios } from '../scenarios';
import { setupContextForScenario } from '../src/support/pageSetup';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { navigate, openApplication, press, pressTarget, recordApplicationBuild, visible } from './appSession';
import { exercisePopup } from './popups';
import { appearance, captureTimeline, CLOCK_START } from './timeline';

test('staging notice fades and scales in on launch', /** 验证启动时 staging 提示的淡入与缩放动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ context, page }, info) => {
  const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SUITE: 'app' })
    .find(/** 按当前视口选择大厅场景，准备对话框动画测试。
 * @param item - 当前遍历的条目。 */ item => item.pageLabel === 'hall' && item.viewport.label === info.project.name)!;
  await setupContextForScenario(context, scenario, page, { animations: 'allow' });
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await recordApplicationBuild(page, info);
  const dialog = page.getByTestId('staging-dialog');
  const title = page.getByTestId('staging-dialog-title');
  await expect(title).toBeAttached({ timeout: 60_000 });
  await page.evaluate(/** 等待对话框所用字体加载，避免采样期间文本重排。 */ () => document.fonts.ready.then(/** 将异步结果转换为`undefined`，供后续步骤使用。 */ () => undefined));
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

test('share link confirmation dialog enter and exit', /** 验证分享链接确认弹窗的进入与退出动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param info - 当前测试的运行与附件信息。 */ async ({ context, page }, info) => {
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
