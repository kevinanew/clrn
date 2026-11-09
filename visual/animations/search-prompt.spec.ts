import { type Locator } from '@playwright/test';
import { expect, test } from '../src/support/networkFixture';
import { buildScenarios } from '../scenarios';
import { ensureAppReadyPastStaging } from '../src/support/authFlow';
import { setupContextForScenario } from '../src/support/pageSetup';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';

// 固定绝对时刻还固定了 requestAnimationFrame 的相位，避免初始化耗时影响中间帧。
const CLOCK_START = new Date('2026-01-01T00:00:00Z');
const ANIMATION_START = new Date('2026-01-01T00:05:00Z');
const CAPTURE_AREA = { x: 16, y: 286, width: 343, height: 240 };
const FRAME_TIMES = [0, 80, 160, 320] as const;

/**
 * 读取弹窗内容及祖先叠加后的透明度，不修改应用的动画样式。
 * @param content - 弹窗的固定文案节点。
 */
async function popupOpacity(content: Locator): Promise<number> {
  return content.evaluate(/** 累乘节点及祖先透明度，检查搜索提示的实际呈现进度。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    let opacity = 1;
    for (let element: Element | null = node; element; element = element.parentElement) {
      opacity *= Number(getComputedStyle(element).opacity);
    }
    return opacity;
  });
}

test('en mobile guest search prompt fades in', /** 验证英文移动端游客搜索提示的淡入动画。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param testInfo - 当前操作使用的 testInfo。 */ async ({ context, page }, testInfo) => {
  const scenario = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SUITE: 'app' })
    .find(/** 定位英文移动端大厅场景，准备搜索登录提示动画。
 * @param item - 当前遍历的条目。 */ item => item.label === 'en_mobile_hall');
  if (!scenario) throw new Error('缺少英文手机大厅场景');
  await setupContextForScenario(context, scenario, page, { animations: 'allow' });
  await page.clock.install({ time: CLOCK_START });
  await page.goto('/');
  await ensureAppReadyPastStaging(page);
  await expect(page.getByTestId('match-game-bet-info').first()).toHaveText('1/2');
  const search = page.getByTestId('hall-search-button');
  const message = page.getByTestId('pop-up-message-text');
  const cancel = page.getByTestId('cancel-button');

  // 先走一次真实开关流程，将弹窗图片和字体加载进缓存，再开始计时采样。
  await search.click();
  await expect(message).toHaveText('Please sign in to use search');
  await expect.poll(/** 轮询提示弹层透明度，等待提示完全显现后采样。 */ () => popupOpacity(message)).toBe(1);
  await page.evaluate(/** 等待搜索提示字体就绪，避免字体加载干扰透明度采样。 */ () => document.fonts.ready.then(/** 将异步结果转换为`undefined`，供后续步骤使用。 */ () => undefined));
  await ensureLocalImagesLoaded(page);
  await cancel.click();
  await expect(message).toBeHidden();
  await expect(search).toBeVisible();

  await page.clock.pauseAt(ANIMATION_START);
  // 页面初始化和所有准备动作均已结束；点击事件在冻结的时刻触发真实动画。
  await search.click();
  await expect(message).toBeAttached();
  expect(await popupOpacity(message), '动画应从透明开始，不能直接显示终态').toBe(0);
  expect(await page.evaluate(/** 检查页面是否启用了视觉回归模式或禁用动画样式。 */ () =>
    Boolean((globalThis as typeof globalThis & { __VISUAL_REGRESSION__?: boolean }).__VISUAL_REGRESSION__)
      || Boolean(document.getElementById('visual-disable-animations')),
  ), '动画用例不能启用静态截图的禁动画开关').toBe(false);

  const samples: { milliseconds: number; opacity: number }[] = [];
  let previousTime = 0;
  try {
    for (const milliseconds of FRAME_TIMES) {
      await page.clock.runFor(milliseconds - previousTime);
      const opacity = await popupOpacity(message);
      samples.push({ milliseconds, opacity });
      await expect(page).toHaveScreenshot(`en-mobile-search-prompt-${milliseconds}ms.png`, {
        clip: CAPTURE_AREA,
      });
      previousTime = milliseconds;
    }
  } finally {
    await testInfo.attach('animation-timeline', {
      body: JSON.stringify({ clip: CAPTURE_AREA, samples }, null, 2),
      contentType: 'application/json',
    });
  }
  expect(samples[1].opacity).toBeGreaterThan(0);
  expect(samples[1].opacity).toBeLessThan(samples[2].opacity);
  expect(samples[2].opacity).toBeLessThan(1);
  expect(samples[3].opacity, '淡入应在 320ms 内完成').toBe(1);

  // 结束后再推进一段时间，确认没有回跳；通过真实按钮关闭并重新打开，检查遮罩释放。
  await page.clock.runFor(160);
  expect(await popupOpacity(message)).toBe(1);
  await cancel.click();
  await page.clock.runFor(400);
  await expect(message).toBeHidden();
  await search.click();
  await page.clock.runFor(400);
  await expect(message).toHaveText('Please sign in to use search');
  expect(await popupOpacity(message)).toBe(1);
});
