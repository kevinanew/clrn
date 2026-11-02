import { expect, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { remainingPixelCount, type ExcludedPixelRectangle } from '../screenshotComparisonConfiguration';

type Rectangle = { x: number; y: number; width: number; height: number };
type PartialComparisonOptions = {
  clip?: Rectangle;
  foregroundBelow?: { y: number; locator: Locator };
  excludedBackground?: Locator[];
};

/**
 * 取得局部比较原有的排除区域，稳定性与基准比较共用相同区域及几何断言。
 * @param frame - 本次实际截图。
 * @param options - 原有裁切、前景或背景排除设置。
 * @param subjects - 采样时记录的动画主体位置。
 * @param name - 报告中的动画名称，入场仍要求弹层存在。
 */
export async function timelineExcludedRegions(frame: Buffer, options: PartialComparisonOptions,
  subjects: Rectangle[], name: string): Promise<ExcludedPixelRectangle[]> {
  const { width, height } = PNG.sync.read(frame);
  const foreground = options.foregroundBelow;
  if (foreground) {
    expect(foreground.y, `${name} 比较区域高度`).toBeGreaterThan(0);
    expect(foreground.y, `${name} 比较区域高度`).toBeLessThanOrEqual(height);
    const box = await foreground.locator.evaluateAll(nodes => {
      if (!nodes[0]) return null;
      const rect = nodes[0].getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    if (name.endsWith('-enter')) expect(box, `${name} 弹层必须保留在画面中`).not.toBeNull();
    const left = box ? Math.max(0, Math.floor(box.x - (options.clip?.x || 0))) : 0;
    const right = box ? Math.min(width, Math.ceil(box.x + box.width - (options.clip?.x || 0))) : 0;
    const top = box ? Math.max(foreground.y, Math.floor(box.y - (options.clip?.y || 0))) : foreground.y;
    const bottom = box ? Math.min(height, Math.ceil(box.y + box.height - (options.clip?.y || 0))) : foreground.y;
    if (right <= left || bottom <= top) return [{ left: 0, right: width, top: foreground.y, bottom: height }];
    return [
      { left: 0, right: width, top: foreground.y, bottom: top },
      { left: 0, right: left, top, bottom },
      { left: right, right: width, top, bottom },
      { left: 0, right: width, top: bottom, bottom: height },
    ];
  }
  const excluded: ExcludedPixelRectangle[] = [];
  for (const background of options.excludedBackground || []) {
    const box = await background.evaluateAll(nodes => {
      if (!nodes[0]) return null;
      const rect = nodes[0].getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(box, `${name} 背景排除区域必须存在`).not.toBeNull();
    for (const subject of subjects) {
      expect(box!.x + box!.width <= subject.x || subject.x + subject.width <= box!.x
        || box!.y + box!.height <= subject.y || subject.y + subject.height <= box!.y,
      `${name} 背景排除区域不能遮住弹层`).toBe(true);
    }
    excluded.push({
      left: Math.max(0, Math.floor(box!.x - (options.clip?.x || 0))),
      right: Math.min(width, Math.ceil(box!.x + box!.width - (options.clip?.x || 0))),
      top: Math.max(0, Math.floor(box!.y - (options.clip?.y || 0))),
      bottom: Math.min(height, Math.ceil(box!.y + box!.height - (options.clip?.y || 0))),
    });
  }
  return excluded;
}

/**
 * 将排除区域替换为参考图对应像素，保留原图供报告，并按并集计算有效面积。
 * @param frame - 实际截图。
 * @param reference - 相邻截图或已有基准。
 * @param excluded - 与本次比较对应的原有排除区域。
 */
export function preparePartialComparison(frame: Buffer, reference: Buffer, excluded: ExcludedPixelRectangle[]) {
  const actual = PNG.sync.read(frame);
  const expected = PNG.sync.read(reference);
  const comparedPixels = remainingPixelCount(actual.width, actual.height, excluded);
  // 保留尺寸变化，交给调用方原有的稳定性或尺寸断言拒绝，不能通过复制像素隐藏。
  if (actual.width !== expected.width || actual.height !== expected.height) return { png: frame, comparedPixels };
  for (const rectangle of excluded) {
    for (let row = Math.max(0, rectangle.top); row < Math.min(actual.height, rectangle.bottom); row++) {
      const start = (row * actual.width + Math.max(0, rectangle.left)) * 4;
      const end = (row * actual.width + Math.min(actual.width, rectangle.right)) * 4;
      if (end > start) actual.data.set(expected.data.subarray(start, end), start);
    }
  }
  return { png: PNG.sync.write(actual), comparedPixels };
}
