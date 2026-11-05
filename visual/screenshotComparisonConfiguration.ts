// 所有 Web 视觉图片比较共用 0.5% 的差异比例上限，颜色容差仍由各入口保留。
export const MAXIMUM_DIFFERENT_PIXEL_RATIO = 0.005;

export type ExcludedPixelRectangle = { left: number; right: number; top: number; bottom: number };

/**
 * 生成实际图片断言的参数；局部比较使用有效面积，不能让排除区域扩大允许差异。
 * @param threshold - 当前入口原有的单像素颜色容差。
 * @param comparedPixels - 局部比较实际保留的像素数；省略时比较完整图片。
 */
export function imageComparisonOptions(threshold: number, comparedPixels?: number) {
  if (comparedPixels === undefined) return { threshold, maxDiffPixelRatio: MAXIMUM_DIFFERENT_PIXEL_RATIO };
  assertComparedPixels(comparedPixels);
  return { threshold, maxDiffPixels: Math.floor(comparedPixels * MAXIMUM_DIFFERENT_PIXEL_RATIO) };
}

/**
 * 按实际遮罩的并集计算有效面积，重叠区域只排除一次，不改变任何遮罩范围。
 * @param width - 截图宽度。
 * @param height - 截图高度。
 * @param rectangles - 已确定的排除区域，边界使用截图像素坐标。
 */
export function remainingPixelCount(width: number, height: number, rectangles: ExcludedPixelRectangle[]): number {
  const excluded = new Uint8Array(width * height);
  let excludedCount = 0;
  for (const rectangle of rectangles) excludedCount += markRectangle(excluded, width, height, rectangle);
  return width * height - excludedCount;
}

/**
 * 拒绝无效局部比较面积。
 * @param pixels - 遮罩外保留的像素数量。
 */
function assertComparedPixels(pixels: number): void {
  if (!Number.isSafeInteger(pixels) || pixels <= 0) throw new Error('有效比较面积必须是正整数');
}

/**
 * 标记矩形并集；重复覆盖仍只占一个像素。
 * @param excluded - 排除像素位图。
 * @param width - 图片宽度。
 * @param height - 图片高度。
 * @param rectangle - 当前矩形。
 */
function markRectangle(excluded: Uint8Array, width: number, height: number, rectangle: ExcludedPixelRectangle): number {
  let count = 0;
  for (let row = Math.max(0, rectangle.top); row < Math.min(height, rectangle.bottom); row++) {
    for (let column = Math.max(0, rectangle.left); column < Math.min(width, rectangle.right); column++) {
      count += markPixel(excluded, row * width + column);
    }
  }
  return count;
}

/**
 * 一个像素仅首次覆盖时增加排除数量。
 * @param excluded - 排除像素位图。
 * @param pixel - 当前像素位置。
 */
function markPixel(excluded: Uint8Array, pixel: number): number {
  if (excluded[pixel]) return 0;
  excluded[pixel] = 1;
  return 1;
}
