import { advanceCardSpriteClock, hasNormalCardSpriteClock } from './cardSpriteClock';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
import { waitForTexasCardSprites } from './cardSpriteReadiness';
import { settleLayout } from './renderReadiness';
import type { CaptureArea } from './captureTypes';
import type { TimelineElement, TimelineOptions } from './timelineTypes';
import { captureFrame } from './timelineCapture';
import { seekCssAnimations, restoreCssAnimations } from './timelineClock';
export { freeze, settleAnimations } from './timelineClock';
export type { CaptureArea } from './captureTypes';
export type { NumericTextMask } from './numericMask';

export const CLOCK_START = new Date('2026-01-01T00:00:00Z');
export const FRAME_TIMES = [0, 80, 160, 320, 640, 1200] as const;

/**
 * 读取元素及祖先的实际呈现状态，只读样式，不修改透明度或位置。
 * @param target - 动画主体或内容标记。
 */
export async function appearance(target: Locator): Promise<TimelineElement[]> {
  return target.evaluateAll(/** 读取目标节点及祖先的透明度、变换和布局，生成动画呈现采样。
 * @param nodes - 当前匹配的页面节点集合。 */ nodes => nodes.map(/** 汇总当前节点的边界及祖先样式，反映实际画面状态。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    const rect = node.getBoundingClientRect();
    let opacity = 1;
    const transforms: string[] = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      opacity *= Number(style.opacity);
      if (style.transform !== 'none') transforms.push(style.transform);
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity, transforms,
      images: Array.from(node.querySelectorAll('img')).map(/** 将当前条目映射为`new URL(img.src).pathname`。
 * @param img - 当前操作使用的 img。 */ img => new URL(img.src).pathname) };
  }));
}

/**
 * 冻结模式保持原 16ms 分步；正常模式按宿主截止时间等待，不额外累加截图耗时。
 * @param page - 牌桌页面。
 * @param duration - 原虚拟时钟推进间隔。
 * @param deadline - 正常时间目标的宿主时间。
 */
async function advanceTimelineTime(page: Page, duration: number, deadline: number) {
  if (hasNormalCardSpriteClock(page)) { await advanceCardSpriteClock(page, Math.max(0, deadline - Date.now())); return; }
  await advanceFrozenTime(page, duration);
}

/**
 * 按原有 16ms 步长推进暂停的页面，零间隔仍提交布局回调。
 * @param page - 时钟暂停的页面。
 * @param duration - 原采样间隔。
 */
async function advanceFrozenTime(page: Page, duration: number) {
  if (duration === 0) await page.clock.runFor(0);
  for (let elapsed = 0; elapsed < duration; elapsed += 16) {
    await page.clock.runFor(Math.min(16, duration - elapsed));
  }
}

/**
 * 汇总固定时刻的截图差异；像素不符继续采样，资源、状态与运动断言失败立即中止。
 * @param page - 虚拟时钟已暂停的页面。
 * @param info - 用例附件与基准命名上下文。
 * @param name - 不包含语言和视口的唯一动画名称。
 * @param target - 用于记录时间线的实际动画元素。
 * @param options - 固定裁切区域、绝对采样时间及是否要求画面发生变化。
 */
export async function captureTimeline(page: Page, info: TestInfo, name: string, target: Locator,
  options: TimelineOptions = {}): Promise<void> {
  assertClockMode(page, options);
  const times = timelineTimes(options);
  const samples = [];
  const frames: Buffer[] = [];
  let previous = 0;
  const started = Date.now();
  await seekCssAnimations(page, 0, true);
  try {
    for (const milliseconds of times) {
      const duration = milliseconds - previous;
      // React 的 MessageChannel 副作用也需要在帧间提交；一次快跑数秒会把倒计时更新合并到末帧。
      await advanceTimelineTime(page, duration, started + milliseconds);
      await seekCssAnimations(page, milliseconds);
      // 新挂载的边框、牌面或道具可能仍在加载。时钟保持暂停，资源就绪后再比较同一关键帧。
      await ensureLocalImagesLoaded(page);
      await settleLayout(page);
      await waitForTimelineSprites(page, options.waitForCardSprites);
      const sampledTime = milliseconds + timelineOffset(options);
      const elements = await appearance(target);
      samples.push({ milliseconds: sampledTime, realElapsed: Date.now() - started, elements });
      const snapshot = `en-${info.project.name}-${name}-${sampledTime}ms.png`;
      const frame = await captureFrame(page, info, name, options, snapshot, elements);
      frames.push(frame);
      previous = milliseconds;
    }
    assertTimelineSamples(samples, frames, name, options);
  } finally {
    await info.attach(`${name}-timeline`, { contentType: 'application/json',
      body: JSON.stringify({ clip: options.clip, samples }, null, 2) });
    // 归还 CSS 动画的播放控制，后续真实开关不能继承上一段的暂停状态。
    await restoreCssAnimations(page);
  }
}

/**
 * 在稳定终态取得固定画幅，之后不跟随移动元素重新裁切。
 * @param page - 当前页面。
 * @param target - 已完成入场的动画区域。
 * @param padding - 为遮罩和位移保留的边缘。
 */
export async function fixedArea(page: Page, target: Locator, padding = 24): Promise<CaptureArea> {
  const box = await target.boundingBox();
  if (!box) throw new Error('动画区域不可见，不能生成空白基准');
  const viewport = page.viewportSize()!;
  const x = Math.max(0, Math.floor(box.x - padding));
  const y = Math.max(0, Math.floor(box.y - padding));
  return { x, y, width: Math.min(viewport.width - x, Math.ceil(box.width + padding * 2)),
    height: Math.min(viewport.height - y, Math.ceil(box.height + padding * 2)) };
}

/**
 * 读取指定采样时刻，空配置沿用固定帧表。
 * @param options - 时间线选项。
 */
function timelineTimes(options: TimelineOptions) { return options.times || FRAME_TIMES; }

/**
 * 保留原有起点偏移的零值回退。
 * @param options - 时间线选项。
 */
function timelineOffset(options: TimelineOptions) { return options.startOffset || 0; }

/**
 * 有牌面就绪要求时保留原硬断言。
 * @param page - 当前页面。
 * @param description - 原牌面断言说明。
 */
async function waitForTimelineSprites(page: Page, description: string | undefined) {
  if (description) await waitForTexasCardSprites(page, description);
}

type TimelineSample = { elements: Awaited<ReturnType<typeof appearance>> };

/**
 * 检查主体运动和不同帧，两项断言仍可独立配置。
 * @param samples - 采样主体状态。
 * @param frames - 实际截图。
 * @param name - 原动画名称。
 * @param options - 原断言选项。
 */
function assertTimelineSamples(samples: TimelineSample[], frames: Buffer[], name: string, options: TimelineOptions) {
  if (options.requireMotion) {
    const states = samples.filter(/** 仅保留满足以下条件的条目：`sample.elements.length > 0`。
 * @param sample - 当前操作使用的 sample。 */ sample => sample.elements.length > 0).map(/** 序列化每个采样点的元素几何与呈现状态，检测动画是否实际变化。
 * @param sample - 当前操作使用的 sample。 */ sample => JSON.stringify(sample.elements.map(/** 将当前条目映射为`{ x, y, width, height, opacity, transforms }`。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ x, y, width, height, opacity, transforms }) =>
      ({ x, y, width, height, opacity, transforms }))));
    expect(new Set(states).size, `${name} 主体本身必须移动、缩放或渐变，不能只靠背景变化`).toBeGreaterThan(1);
  }
  if (options.requireChange !== false) {
    expect(frames.some(/** 判断是否存在满足以下条件的条目：`!frame.equals(frames[0])`。
 * @param frame - 当前操作使用的 frame。 */ frame => !frame.equals(frames[0])), `${name} 必须包含不同的动画帧`).toBe(true);
  }
}

/**
 * 正常时钟仅允许取证，仍禁止与固定相位基准比较。
 * @param page - 当前页面。
 * @param options - 原采样模式。
 */
function assertClockMode(page: Page, options: TimelineOptions) {
  expect(!hasNormalCardSpriteClock(page) || options.observeFrames, '原生时间仅用于独立取证，不可比较固定相位基准').toBe(true);
}
