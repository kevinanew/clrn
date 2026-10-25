import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';

export const CLOCK_START = new Date('2026-01-01T00:00:00Z');
export const FRAME_TIMES = [0, 80, 160, 320, 640, 1200] as const;
export type CaptureArea = { x: number; y: number; width: number; height: number };
const pausedPages = new WeakSet<Page>();

/**
 * 等待浏览器真实布局通知，再运行同一虚拟时刻的测量回调；不推进动画进度。
 * @param page - 时钟已暂停的页面。
 */
async function settleLayout(page: Page): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(() => new Promise<void>(resolve => {
      const observer = new ResizeObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(document.documentElement);
    }));
    // RN Web 的 onLayout 经 ResizeObserver -> setTimeout(0) -> React 更新后才生效。
    await page.clock.runFor(0);
  }
}

/**
 * 读取元素及祖先的实际呈现状态，只读样式，不修改透明度或位置。
 * @param target - 动画主体或内容标记。
 */
export async function appearance(target: Locator) {
  return target.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    let opacity = 1;
    const transforms: string[] = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      opacity *= Number(style.opacity);
      if (style.transform !== 'none') transforms.push(style.transform);
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity, transforms,
      images: Array.from(node.querySelectorAll('img')).map(img => new URL(img.src).pathname) };
  }));
}

/**
 * 固定浏览器 CSS 动画的时间；JS 动画仍由 Playwright 虚拟时钟推进。
 * @param page - 保留真实动画的页面。
 * @param elapsed - 自采样起点经过的毫秒数。
 * @param reset - 是否开始新的采样区间。
 */
async function seekCssAnimations(page: Page, elapsed: number, reset = false): Promise<void> {
  await page.evaluate(({ elapsed, reset }) => {
    const state = window as typeof window & { animationSamples?: Map<Animation, number> };
    if (reset || !state.animationSamples) state.animationSamples = new Map();
    for (const animation of document.getAnimations()) {
      if (!state.animationSamples.has(animation)) state.animationSamples.set(animation, elapsed);
      animation.pause();
      animation.currentTime = elapsed - state.animationSamples.get(animation)!;
    }
  }, { elapsed, reset });
}

/**
 * 推进准备阶段的动画并处理结束回调，避免用真实等待混合虚拟时钟。
 * @param page - 时钟已暂停的页面。
 * @param duration - 固定推进时长。
 * @param fast - 牌桌的定时动画预热可跳过中间帧，正式采样始终逐帧推进。
 */
export async function settleAnimations(page: Page, duration: number, fast = false): Promise<void> {
  await page.clock.runFor(16);
  await seekCssAnimations(page, 0, true);
  if (fast) await page.clock.fastForward(duration);
  else await page.clock.runFor(duration);
  await seekCssAnimations(page, duration);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && end !== Infinity && Number(animation.currentTime) >= end) animation.finish();
    }
  });
  await page.clock.runFor(32);
}

/**
 * 在准备和图片预热之后固定 requestAnimationFrame 相位，禁止静态套件的动画替身。
 * @param page - 待冻结页面。
 */
export async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ensureLocalImagesLoaded(page);
  const now = await page.evaluate(() => Date.now());
  // 首次暂停时浏览器还在走真实时间，为较慢 Linux 的协议往返留出余量。
  // 后续已暂停的页面保持原有预热间隔，避免每次打开面板都跳过大量业务定时器。
  await page.clock.pauseAt(Math.ceil((now + (pausedPages.has(page) ? 1000 : 5000)) / 16) * 16);
  pausedPages.add(page);
  // CSS 使用浏览器真实时钟。挂载时立即暂停，避免协议往返较慢时淡入在第一帧前已结束。
  await page.evaluate(() => {
    const state = window as typeof window & { animationCssObserver?: MutationObserver };
    if (state.animationCssObserver) return;
    const seen = new WeakSet<Animation>();
    /** 新 CSS 动画交由采样器推进，保留原始关键帧和时长。 */
    const pauseNewAnimations = () => {
      for (const animation of document.getAnimations()) {
        if (seen.has(animation)) continue;
        seen.add(animation);
        animation.pause();
        animation.currentTime = 0;
      }
    };
    state.animationCssObserver = new MutationObserver(records => {
      // JS 动画每帧修改 transform/opacity；这些更新不会创建 CSS 动画，不必强制重新布局。
      if (records.some(record => record.type === 'childList' || record.attributeName === 'class'
        || (record.target instanceof HTMLElement && Boolean(record.target.style.animationName)))) {
        pauseNewAnimations();
      }
    });
    state.animationCssObserver.observe(document.documentElement,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    pauseNewAnimations();
  });
  expect(await page.evaluate(() => Boolean(
    (globalThis as typeof globalThis & { __VISUAL_REGRESSION__?: boolean }).__VISUAL_REGRESSION__
      || document.getElementById('visual-disable-animations'),
  )), '动画套件不得使用静态截图的禁动画开关').toBe(false);
}

/**
 * 比较固定时刻的真实画面，并在失败时也保存位置、透明度和变换采样。
 * @param page - 虚拟时钟已暂停的页面。
 * @param info - 用例附件与基准命名上下文。
 * @param name - 不包含语言和视口的唯一动画名称。
 * @param target - 用于记录时间线的实际动画元素。
 * @param options - 固定裁切区域、绝对采样时间及是否要求画面发生变化。
 */
export async function captureTimeline(page: Page, info: TestInfo, name: string, target: Locator,
  options: { clip?: CaptureArea; times?: readonly number[]; requireChange?: boolean; startOffset?: number;
    mask?: Locator[]; requireMotion?: boolean;
    foregroundBelow?: { y: number; locator: Locator }; excludedBackground?: Locator[] } = {}): Promise<void> {
  const times = options.times || FRAME_TIMES;
  const samples = [];
  const frames: Buffer[] = [];
  let previous = 0;
  await seekCssAnimations(page, 0, true);
  try {
    for (const milliseconds of times) {
      const duration = milliseconds - previous;
      // React 的 MessageChannel 副作用也需要在帧间提交；一次快跑数秒会把倒计时更新合并到末帧。
      if (duration === 0) await page.clock.runFor(0);
      for (let elapsed = 0; elapsed < duration; elapsed += 16) {
        await page.clock.runFor(Math.min(16, duration - elapsed));
      }
      await seekCssAnimations(page, milliseconds);
      // 新挂载的边框、牌面或道具可能仍在加载。时钟保持暂停，资源就绪后再比较同一关键帧。
      await ensureLocalImagesLoaded(page);
      await settleLayout(page);
      const sampledTime = milliseconds + (options.startOffset || 0);
      samples.push({ milliseconds: sampledTime, elements: await appearance(target) });
      const snapshot = `en-${info.project.name}-${name}-${sampledTime}ms.png`;
      const screenshotOptions = { clip: options.clip, mask: options.mask, animations: 'allow' as const,
        caret: 'hide' as const, scale: 'css' as const };
      const foregroundBelow = options.foregroundBelow;
      let frame: Buffer;
      if (foregroundBelow) {
        // 弹层缩放期间保留其每帧实际覆盖的像素，排除下方未被遮住的牌桌操作区。
        // 暂停时钟后连续截图一致，才将相关区域交给 Playwright 原有像素比较器。
        frame = Buffer.alloc(0);
        await expect.poll(async () => {
          const previousFrame = await page.screenshot(screenshotOptions);
          frame = await page.screenshot(screenshotOptions);
          return frame.equals(previousFrame);
        }, { message: `${name} 首帧画面应稳定` }).toBe(true);
        const snapshotPath = info.snapshotPath(snapshot, { kind: 'screenshot' });
        const update = info.config.updateSnapshots;
        if (update === 'all' || update === 'changed' || (update === 'missing' && !existsSync(snapshotPath))) {
          // 显式生成候选基准时保存完整画面，不能依赖旧图或写入拼接后的比较图。
          expect(frame).toMatchSnapshot(snapshot, { threshold: 0.1, maxDiffPixelRatio: 0.001 });
        } else {
          const actual = PNG.sync.read(frame);
          const expected = PNG.sync.read(readFileSync(snapshotPath));
          expect([actual.width, actual.height], `${snapshot} 基准尺寸`).toEqual([expected.width, expected.height]);
          expect(foregroundBelow.y, `${snapshot} 比较区域高度`).toBeGreaterThan(0);
          expect(foregroundBelow.y, `${snapshot} 比较区域高度`).toBeLessThanOrEqual(actual.height);
          // 退场末帧弹层可能已卸载；此时只比较指定高度以上的画面。
          const box = await foregroundBelow.locator.evaluateAll(nodes => {
            if (!nodes[0]) return null;
            const rect = nodes[0].getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          });
          if (name.endsWith('-enter')) expect(box, `${snapshot} 弹层必须保留在画面中`).not.toBeNull();
          const x = box ? Math.max(0, Math.floor(box.x - (options.clip?.x || 0))) : 0;
          const right = box ? Math.min(actual.width, Math.ceil(box.x + box.width - (options.clip?.x || 0))) : 0;
          const top = box ? Math.max(foregroundBelow.y, Math.floor(box.y - (options.clip?.y || 0))) : foregroundBelow.y;
          const bottom = box ? Math.min(actual.height, Math.ceil(box.y + box.height - (options.clip?.y || 0))) : foregroundBelow.y;
          for (let row = foregroundBelow.y; row < actual.height; row++) {
            const start = row * actual.width * 4;
            if (row < top || row >= bottom) {
              actual.data.set(expected.data.subarray(start, start + actual.width * 4), start);
            } else {
              actual.data.set(expected.data.subarray(start, start + x * 4), start);
              actual.data.set(expected.data.subarray(start + right * 4, start + actual.width * 4), start + right * 4);
            }
          }
          const comparedPixels = actual.width * foregroundBelow.y + Math.max(0, bottom - top) * Math.max(0, right - x);
          expect(PNG.sync.write(actual)).toMatchSnapshot(snapshot, {
            threshold: 0.1, maxDiffPixels: Math.floor(comparedPixels * 0.001),
          });
        }
      } else if (options.excludedBackground?.length) {
        // 比较仍保存完整原图；只在比对弹层时排除独立用例已覆盖的背景动画。
        frame = Buffer.alloc(0);
        await expect.poll(async () => {
          const previousFrame = await page.screenshot(screenshotOptions);
          frame = await page.screenshot(screenshotOptions);
          return frame.equals(previousFrame);
        }, { message: `${name} 首帧画面应稳定` }).toBe(true);
        const snapshotPath = info.snapshotPath(snapshot, { kind: 'screenshot' });
        const update = info.config.updateSnapshots;
        if (update === 'all' || update === 'changed' || (update === 'missing' && !existsSync(snapshotPath))) {
          expect(frame).toMatchSnapshot(snapshot, { threshold: 0.1, maxDiffPixelRatio: 0.001 });
        } else {
          const actual = PNG.sync.read(frame);
          const expected = PNG.sync.read(readFileSync(snapshotPath));
          expect([actual.width, actual.height], `${snapshot} 基准尺寸`).toEqual([expected.width, expected.height]);
          for (const background of options.excludedBackground) {
            const box = await background.boundingBox();
            expect(box, `${snapshot} 背景排除区域必须存在`).not.toBeNull();
            const subject = await target.boundingBox();
            if (subject) expect(box!.x + box!.width <= subject.x || subject.x + subject.width <= box!.x
              || box!.y + box!.height <= subject.y || subject.y + subject.height <= box!.y,
            `${snapshot} 背景排除区域不能遮住弹层`).toBe(true);
            const left = Math.max(0, Math.floor(box!.x - (options.clip?.x || 0)));
            const right = Math.min(actual.width, Math.ceil(box!.x + box!.width - (options.clip?.x || 0)));
            const top = Math.max(0, Math.floor(box!.y - (options.clip?.y || 0)));
            const bottom = Math.min(actual.height, Math.ceil(box!.y + box!.height - (options.clip?.y || 0)));
            for (let row = top; row < bottom; row++) {
              const start = (row * actual.width + left) * 4;
              const end = (row * actual.width + right) * 4;
              actual.data.set(expected.data.subarray(start, end), start);
            }
          }
          expect(PNG.sync.write(actual)).toMatchSnapshot(snapshot,
            { threshold: 0.1, maxDiffPixelRatio: 0.001 });
        }
      } else {
        // 时钟停在同一关键帧，等待浏览器完成布局/绘制；连续两张一致才进行基准比较。
        await expect(page).toHaveScreenshot(snapshot, {
          ...screenshotOptions, threshold: 0.1, maxDiffPixelRatio: 0.001,
        });
        frame = await page.screenshot(screenshotOptions);
      }
      frames.push(frame);
      previous = milliseconds;
    }
    if (options.requireMotion) {
      const states = samples.filter(sample => sample.elements.length > 0).map(sample => JSON.stringify(sample.elements.map(({ x, y, width, height, opacity, transforms }) =>
        ({ x, y, width, height, opacity, transforms }))));
      expect(new Set(states).size, `${name} 主体本身必须移动、缩放或渐变，不能只靠背景变化`).toBeGreaterThan(1);
    }
    if (options.requireChange !== false) {
      expect(frames.some(frame => !frame.equals(frames[0])), `${name} 必须包含不同的动画帧`).toBe(true);
    }
  } finally {
    await info.attach(`${name}-timeline`, { contentType: 'application/json',
      body: JSON.stringify({ clip: options.clip, samples }, null, 2) });
    // 归还 CSS 动画的播放控制，后续真实开关不能继承上一段的暂停状态。
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        const end = animation.effect?.getComputedTiming().endTime;
        // 对已结束的 CSS 动画调用 play() 会从头重放，导致退场遮罩再次拦截点击。
        if (typeof end === 'number' && end !== Infinity && Number(animation.currentTime) >= end) animation.finish();
        else animation.play();
      }
    });
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
