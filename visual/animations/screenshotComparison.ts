import { MAXIMUM_DIFFERENT_PIXEL_RATIO } from '../screenshotComparisonConfiguration';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * 沿用截图断言的颜色阈值和差异比例，判断相邻截图是否已经稳定。
 * PNG 压缩字节、抗锯齿微差不能被误判为持续动画；尺寸变化始终不稳定。
 * @param firstScreenshot - 同一虚拟时刻的前一张截图。
 * @param secondScreenshot - 同一虚拟时刻的后一张截图。
 * @param comparedPixels - 遮罩后实际保留的比较面积；默认使用完整截图面积。
 */
export function areScreenshotsEquivalent(firstScreenshot: Buffer, secondScreenshot: Buffer, comparedPixels?: number): boolean {
  if (firstScreenshot.equals(secondScreenshot)) return true;
  const firstImage = PNG.sync.read(firstScreenshot);
  const secondImage = PNG.sync.read(secondScreenshot);
  if (firstImage.width !== secondImage.width || firstImage.height !== secondImage.height) return false;
  const differentPixels = pixelmatch(firstImage.data, secondImage.data, null,
    firstImage.width, firstImage.height, { threshold: 0.1 });
  return differentPixels <= (comparedPixels ?? firstImage.width * firstImage.height) * MAXIMUM_DIFFERENT_PIXEL_RATIO;
}
