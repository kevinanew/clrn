import type { Locator } from '@playwright/test';

/**
 * 只读记录选择边框的布局、图片和原生动画状态，区分首帧挂载、资源与相位问题。
 * @param target - 本次比牌选择动画的图片父节点。
 */
export async function challengeDiagnostics(target: Locator): Promise<unknown> {
  try {
    return await target.evaluateAll(/** 仅从本轮选择边框提取不含文本和地址的呈现状态。
     * @param nodes - 选择边框节点。 */ nodes => nodes.map(/** 读取一个边框的原始状态。
     * @param node - 图片父节点。 */ node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const animations = document.getAnimations().filter(/** 仅检查直接作用于边框的动画。
       * @param animation - 浏览器动画对象。 */ animation =>
        animation.effect instanceof KeyframeEffect && animation.effect.target === node);
      return { width: rect.width, height: rect.height, opacity: style.opacity,
        backgroundReady: style.backgroundImage !== 'none',
        images: Array.from(node.querySelectorAll('img')).map(/** 记录加载结果，排除资源 URL。
         * @param img - 边框图片。 */ img => ({ complete: img.complete,
          width: img.naturalWidth, height: img.naturalHeight })),
        animations: animations.map(/** 保留原生相位与呈现进度，不修改动画。
         * @param animation - 边框动画。 */ animation => ({ playState: animation.playState, pending: animation.pending,
          currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
          startTime: typeof animation.startTime === 'number' ? animation.startTime : null,
          progress: animation.effect?.getComputedTiming().progress })) };
    }));
  } catch {
    // 诊断不可覆盖采样或测试的原始失败。
    return { unavailable: true };
  }
}
