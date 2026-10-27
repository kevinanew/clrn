import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { appearance, captureTimeline, fixedArea, freeze, settleAnimations, type CaptureArea } from './timeline';

export type PopupFlow = { name: string; target: Locator; open: () => Promise<unknown>;
  close: () => Promise<unknown>; clip?: CaptureArea; exitAnimated?: boolean; fastPreparation?: boolean;
  foregroundBelow?: { y: number; locator: Locator }; requirePresentation?: boolean;
  excludedBackground?: Locator[]; waitForUnmountBeforeReopen?: boolean;
  beforeEntrance?: () => Promise<void>; afterEntrance?: () => Promise<void>;
  entranceFinalFrameMask?: Locator[] };

/**
 * 判断弹层是否已经进入视口且实际绘制，不能把尚未卸载的透明旧节点算作新弹层。
 * @param target - 待检查的弹层内容。
 */
async function isPresented(target: Locator): Promise<boolean> {
  if (!(await target.isVisible())) return false;
  const viewport = target.page().viewportSize()!;
  return (await appearance(target)).some(state => state.opacity > 0 && state.width > 0 && state.height > 0
    && state.x < viewport.width && state.x + state.width > 0
    && state.y < viewport.height && state.y + state.height > 0);
}

/**
 * 逐帧推进异步请求和原生弹窗退场，直到新弹层真正出现在画面中。
 * @param target - 真实弹层内容。
 * @param requirePresentation - 是否要求弹层实际绘制，而不是只保留节点。
 */
async function waitForMount(target: Locator, requirePresentation = false): Promise<void> {
  /** 判断本次打开是否已达到所需状态。 */
  const mounted = async () => requirePresentation ? isPresented(target) : (await target.count()) > 0;
  await expect.poll(async () => {
    if (await mounted()) return true;
    await target.page().clock.runFor(16);
    return mounted();
  }, { intervals: [20], timeout: 30_000,
    message: `弹层应从真实入口${requirePresentation ? '进入画面' : '挂载'}：${target}` }).toBe(true);
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
 * 某些弹层在退场动画结束后才清除内部打开状态；重开前等待旧节点卸载。
 * @param target - 退场后应卸载的弹层内容。
 */
async function waitForUnmount(target: Locator): Promise<void> {
  await expect.poll(async () => {
    if (await target.count() === 0) return true;
    await target.page().clock.runFor(16);
    return await target.count() === 0;
  }, { intervals: [20], timeout: 30_000, message: `重开前旧弹层应卸载：${target}` }).toBe(true);
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
  await waitForMount(flow.target, flow.requirePresentation);
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expect(flow.target).toBeVisible();
  await ensureLocalImagesLoaded(page);
  const clip = flow.clip || await fixedArea(page, flow.target);
  await flow.close();
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expectDismissed(flow.target);
  if (flow.waitForUnmountBeforeReopen) await waitForUnmount(flow.target);
  await freeze(page);
  await flow.open();
  // BottomSheet 在下一次 requestAnimationFrame 挂载内容；时间线保留这 16ms。
  await page.clock.runFor(16);
  await waitForMount(flow.target, flow.requirePresentation);
  await flow.beforeEntrance?.();
  await captureTimeline(page, info, `${flow.name}-enter`, flow.target, { clip, startOffset: 16,
    requireMotion: true, foregroundBelow: flow.foregroundBelow, excludedBackground: flow.excludedBackground,
    finalFrameMask: flow.entranceFinalFrameMask });
  await expect(flow.target).toBeVisible();
  await flow.afterEntrance?.();
  await flow.close();
  await captureTimeline(page, info, `${flow.name}-exit`, flow.target,
    { clip, requireChange: flow.exitAnimated !== false, requireMotion: flow.exitAnimated !== false,
      foregroundBelow: flow.foregroundBelow, excludedBackground: flow.excludedBackground });
  await settleAnimations(page, 32);
  await expectDismissed(flow.target);
  if (flow.waitForUnmountBeforeReopen) await waitForUnmount(flow.target);
  await flow.open();
  await waitForMount(flow.target, flow.requirePresentation);
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expect(flow.target).toBeVisible();
  await flow.close();
  await settleAnimations(page, 1600, flow.fastPreparation);
  await expectDismissed(flow.target);
  if (flow.waitForUnmountBeforeReopen) await waitForUnmount(flow.target);
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
