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
  if (!Number.isSafeInteger(comparedPixels) || comparedPixels <= 0) throw new Error('有效比较面积必须是正整数');
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
  for (const rectangle of rectangles) {
    for (let row = Math.max(0, rectangle.top); row < Math.min(height, rectangle.bottom); row++) {
      for (let column = Math.max(0, rectangle.left); column < Math.min(width, rectangle.right); column++) {
        const pixel = row * width + column;
        if (!excluded[pixel]) { excluded[pixel] = 1; excludedCount++; }
      }
    }
  }
  return width * height - excludedCount;
}
