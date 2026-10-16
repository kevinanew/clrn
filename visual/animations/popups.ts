import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { appearance, captureTimeline, fixedArea, freeze, settleAnimations, type CaptureArea } from './timeline';

export type PopupFlow = { name: string; target: Locator; open: () => Promise<unknown>;
  close: () => Promise<unknown>; clip?: CaptureArea; exitAnimated?: boolean; fastPreparation?: boolean;
  firstFrameMaxDiffPixelRatio?: number };

/**
 * 等待异步请求触发的挂载时同时推进任务队列，避免响应后的零延迟任务卡在暂停时钟。
 * @param target - 真实弹层内容。
 */
async function waitForMount(target: Locator): Promise<void> {
  await expect.poll(async () => {
    if (await target.count()) return true;
    await target.page().clock.runFor(16);
    return (await target.count()) > 0;
  }, { message: `弹层应从真实入口挂载：${target}` }).toBe(true);
}

/**
 * 同时识别卸载、透明和移出视口的退场，保留 DOM 的弹层也不能仍显示。
 * @param target - 弹层内容标记。
 */
async function expectDismissed(target: Locator): Promise<void> {
  await expect.poll(async () => {
    if (!(await target.isVisible())) return true;
    const viewport = target.page().viewportSize()!;
    return (await appearance(target)).every(state => state.opacity === 0 || state.y >= viewport.height
      || state.y + state.height <= 0 || state.x >= viewport.width || state.x + state.width <= 0);
  }, { message: '关闭后的弹层应卸载、完全透明或移出视口' }).toBe(true);
}

/**
 * 真实开关预热资源后采样入退场；最后重新打开，检查遮罩没有阻断入口。
 * @param page - 初始化后的页面。
 * @param info - 用例报告信息。
 * @param flow - 弹层定位、实际入口及关闭动作。
 */
export async function exercisePopup(page: Page, info: TestInfo, flow: PopupFlow): Promise<void> {
  console.log(`ANIMATION > ${flow.name}`);
  await freeze(page);
  await flow.open();
  await page.clock.runFor(16);
  await waitForMount(flow.target);
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expect(flow.target).toBeVisible();
  await ensureLocalImagesLoaded(page);
  const clip = flow.clip || await fixedArea(page, flow.target);
  await flow.close();
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expectDismissed(flow.target);
  await freeze(page);
  await flow.open();
  // BottomSheet 在下一次 requestAnimationFrame 挂载内容；时间线保留这 16ms。
  await page.clock.runFor(16);
  await waitForMount(flow.target);
  await captureTimeline(page, info, `${flow.name}-enter`, flow.target, { clip, startOffset: 16,
    requireMotion: true, firstFrameMaxDiffPixelRatio: flow.firstFrameMaxDiffPixelRatio });
  await expect(flow.target).toBeVisible();
  await flow.close();
  await captureTimeline(page, info, `${flow.name}-exit`, flow.target,
    { clip, requireChange: flow.exitAnimated !== false, requireMotion: flow.exitAnimated !== false });
  await settleAnimations(page, 32);
  await expectDismissed(flow.target);
  await flow.open();
  await waitForMount(flow.target);
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expect(flow.target).toBeVisible();
  await flow.close();
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expectDismissed(flow.target);
}

/**
 * 牌桌面板使用 timing 动画，准备阶段快进到完成状态；正式入退场仍逐帧比较。
 * @param page - 当前牌桌。
 * @param info - 时间线报告。
 * @param flow - 真实打开与关闭入口。
 */
export function exerciseTablePopup(page: Page, info: TestInfo, flow: PopupFlow): Promise<void> {
  return exercisePopup(page, info, { ...flow, fastPreparation: true });
}
