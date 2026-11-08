import { expect, type Page } from '@playwright/test';
import { advanceCardSpriteClock, hasNormalCardSpriteClock } from './cardSpriteClock';
import { ensureLocalImagesLoaded } from '../src/support/pageStabilizers';
const pausedPages = new WeakSet<Page>();

/**
 * 固定浏览器 CSS 动画的时间；JS 动画仍由 Playwright 虚拟时钟推进。
 * @param page - 保留真实动画的页面。
 * @param elapsed - 自采样起点经过的毫秒数。
 * @param reset - 是否开始新的采样区间。
 */
export async function seekCssAnimations(page: Page, elapsed: number, reset = false): Promise<void> {
  if (hasNormalCardSpriteClock(page)) return;
  await page.evaluate(/** 初始化或更新页面动画采样表，按采样进度推进动画时间。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ ({ elapsed, reset }) => {
    const state = window as typeof window & { animationSamples?: Map<Animation, number> };
    // 对象方法避免 tsx 为嵌套函数注入浏览器中不存在的 __name。
    const sampling = {
      /**
       * 新采样区间清空起点，否则保留此前动画的挂载时刻。
       */
      sampleStarts() {
        if (reset) return new Map<Animation, number>();
        return state.animationSamples || new Map<Animation, number>();
      }
    };
    state.animationSamples = sampling.sampleStarts();
    const starts = state.animationSamples;
    const tracking = {
      /**
       * 记录新动画的起点，已有动画不重置。
       * @param animation - 当前动画。
       */
      remember(animation: Animation) {
        if (!starts.has(animation)) starts.set(animation, elapsed);
      }
    };
    for (const animation of document.getAnimations()) {
      tracking.remember(animation);
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
  if (hasNormalCardSpriteClock(page)) {
    await advanceCardSpriteClock(page, 16 + duration + 32);
    return;
  }
  await settleFrozenAnimations(page, duration, fast);
}

/**
 * 在暂停时钟上执行原来的预热次序与结束回调。
 * @param page - 暂停的页面。
 * @param duration - 原预热时长。
 * @param fast - 是否跳过中间帧。
 */
async function settleFrozenAnimations(page: Page, duration: number, fast: boolean) {
  await page.clock.runFor(16);
  await seekCssAnimations(page, 0, true);
  if (fast) await page.clock.fastForward(duration);
  else await page.clock.runFor(duration);
  await seekCssAnimations(page, duration);
  await page.evaluate(controlCssAnimations, false);
  await page.clock.runFor(32);
}

/**
 * 统一完成和恢复 CSS 动画，保持逐个读取终态与结束回调的原顺序。
 * @param restore - 是否归还未结束动画的播放控制。
 */
function controlCssAnimations(restore: boolean) {
  const controls = {
    /**
     * 有限且到达终点的动画才能结束。
     * @param animation - 待检查动画。
     */
    elapsed(animation: Animation) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end !== 'number') return false;
      return controls.reachedEnd(animation, end);
    },
    /**
     * 无限动画保持原播放状态。
     * @param animation - 待检查动画。
     * @param end - 动画结束时间。
     */
    reachedEnd(animation: Animation, end: number) {
      return end !== Infinity && Number(animation.currentTime) >= end;
    },
    /**
     * 已结束动画只触发 finish，未结束动画按调用场景处理。
     * @param animation - 当前 CSS 动画。
     */
    control(animation: Animation) {
      if (controls.elapsed(animation)) animation.finish();
      else controls.resume(animation);
    },
    /**
     * 预热保持暂停，归还阶段才播放未完成动画。
     * @param animation - 未完成的动画。
     */
    resume(animation: Animation) {
      if (restore) animation.play();
    }
  };
  for (const animation of document.getAnimations()) controls.control(animation);
}

/**
 * 归还 CSS 播放控制，已完成的退场动画不得重播。
 * @param page - 当前页面。
 */
export async function restoreCssAnimations(page: Page) {
  if (hasNormalCardSpriteClock(page)) return;
  await page.evaluate(controlCssAnimations, true);
}

/**
 * 在准备和图片预热之后固定 requestAnimationFrame 相位，禁止静态套件的动画替身。
 * @param page - 待冻结页面。
 */
export async function freeze(page: Page): Promise<void> {
  await page.evaluate(/** 在页面中读取`document.fonts.ready.then(() => undefined)`，供测试判断当前界面状态。 */ () => document.fonts.ready.then(/** 将异步结果转换为`undefined`，供后续步骤使用。 */ () => undefined));
  await ensureLocalImagesLoaded(page);
  if (hasNormalCardSpriteClock(page)) return;
  const now = await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now());
  // 首次暂停时浏览器还在走真实时间，为较慢 Linux 的协议往返留出余量。
  // 后续已暂停的页面保持原有预热间隔，避免每次打开面板都跳过大量业务定时器。
  await page.clock.pauseAt(Math.ceil((now + (pausedPages.has(page) ? 1000 : 5000)) / 16) * 16);
  pausedPages.add(page);
  // CSS 使用浏览器真实时钟。挂载时立即暂停，避免协议往返较慢时淡入在第一帧前已结束。
  await page.evaluate(/** 安装 CSS 动画观察器，暂停新动画并交由时间线采样器推进。 */ () => {
    const state = window as typeof window & { animationCssObserver?: MutationObserver };
    if (state.animationCssObserver) return;
    const seen = new WeakSet<Animation>();
    const observer = {
      /** 新 CSS 动画交由采样器推进，保留原始关键帧和时长。 */
      pauseNewAnimations() {
        for (const animation of document.getAnimations()) {
          if (seen.has(animation)) continue;
          seen.add(animation);
          animation.pause();
          animation.currentTime = 0;
        }
      },
      /**
       * 仅检查 style 中显式声明的动画名。
       * @param target - 变更所属节点。
       */
      hasAnimationName(target: Node) {
        return target instanceof HTMLElement && Boolean(target.style.animationName);
      }
    };
    state.animationCssObserver = new MutationObserver(/** 仅在可能新增 CSS 动画的 DOM 变化后更新暂停状态。
 * @param records - 当前操作使用的 records。 */ records => {
      // JS 动画每帧修改 transform/opacity；这些更新不会创建 CSS 动画，不必强制重新布局。
      if (records.some(/** 判断变更是否涉及节点、class 或显式动画名称。
 * @param record - 当前操作使用的 record。 */ record => record.type === 'childList' || record.attributeName === 'class'
        || observer.hasAnimationName(record.target))) {
        observer.pauseNewAnimations();
      }
    });
    state.animationCssObserver.observe(document.documentElement,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    observer.pauseNewAnimations();
  });
  expect(await page.evaluate(/** 检查页面是否启用会干扰真实动画的视觉回归模式。 */ () => Boolean(
    (globalThis as typeof globalThis & { __VISUAL_REGRESSION__?: boolean }).__VISUAL_REGRESSION__
      || document.getElementById('visual-disable-animations'),
  )), '动画套件不得使用静态截图的禁动画开关').toBe(false);
}

