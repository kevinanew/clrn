import type { Page, TestInfo } from '@playwright/test';

/** 仅在启动背景比较失败后读取资源与动画状态，不等待、解码或改变采样。
 * @param page - 原时间线页面。
 * @param info - 原测试报告。
 * @param snapshot - 已比较的失败帧。
 */
export async function recordLaunchBackgroundFailure(page: Page, info: TestInfo, snapshot: string): Promise<void> {
  try {
    const body = await page.evaluate(/** 不输出地址、正文、存储内容或业务标识。 */ () => ({
      images: Array.from(document.images).map(/** 记录实际图片是否已具备解码尺寸。
       * @param image - 页面已有图片。 */ image => ({
        complete: image.complete, width: image.naturalWidth, height: image.naturalHeight,
        visible: image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      })),
      backgrounds: Array.from(document.querySelectorAll('[data-testid="video-background-image"], [data-testid="launch-screen-container"]'))
        .map(/** 只记录固定背景节点的几何及绘制状态。
         * @param node - 当前背景节点。 */ node => ({
          width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
          opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform,
          backgroundImages: (getComputedStyle(node).backgroundImage.match(/url\(/g) || []).length,
          animations: node.getAnimations().map(/** 只读动画时间，保留原相位。
           * @param animation - 背景已有动画。 */ animation => ({
            time: typeof animation.currentTime === 'number' ? animation.currentTime : null,
            progress: animation.effect?.getComputedTiming().progress, playState: animation.playState,
          })),
        })),
      videos: Array.from(document.querySelectorAll('video')).map(/** 只读视频加载及播放状态。
       * @param video - 页面已有视频。 */ video => ({
        readyState: video.readyState, networkState: video.networkState,
        time: video.currentTime, paused: video.paused, errorCode: video.error?.code,
      })),
    }));
    await info.attach(`${snapshot}-launch-background-state`, { body: JSON.stringify(body), contentType: 'application/json' });
  } catch { /* 诊断失败不能覆盖原快照差异。 */ }
}
