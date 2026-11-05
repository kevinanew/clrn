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
 * 读取首个元素的实际位置，保留原有的缺失判断。
 * @param locator - 原有前景或背景定位器。
 */
async function locatorRectangle(locator: Locator): Promise<Rectangle | null> {
  return locator.evaluateAll(/** 返回首个匹配元素的矩形，未挂载时明确返回空值。
 * @param nodes - 当前匹配的页面节点集合。 */ nodes => {
    if (!nodes[0]) return null;
    const rect = nodes[0].getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

/**
 * 将页面坐标按原有取整方式转换到截图坐标。
 * @param box - 页面中的元素位置。
 * @param clip - 截图原有裁切区域。
 * @param size - 实际截图大小。
 */
function screenshotRectangle(box: Rectangle, clip: Rectangle | undefined, size: { width: number; height: number }) {
  const x = clip?.x || 0, y = clip?.y || 0;
  return { left: Math.max(0, Math.floor(box.x - x)), right: Math.min(size.width, Math.ceil(box.x + box.width - x)),
    top: Math.max(0, Math.floor(box.y - y)), bottom: Math.min(size.height, Math.ceil(box.y + box.height - y)) };
}

/**
 * 排除分界线以下未被前景覆盖的像素；退场卸载后仍比较分界线以上。
 * @param size - 实际截图大小。
 * @param foreground - 原有前景定位器及分界线。
 * @param clip - 原有裁切区域。
 * @param name - 动画名称。
 */
async function foregroundRegions(size: { width: number; height: number },
  foreground: { y: number; locator: Locator }, clip: Rectangle | undefined, name: string) {
  const { width, height } = size;
  expect(foreground.y, `${name} 比较区域高度`).toBeGreaterThan(0);
  expect(foreground.y, `${name} 比较区域高度`).toBeLessThanOrEqual(height);
  const box = await locatorRectangle(foreground.locator);
  if (name.endsWith('-enter')) expect(box, `${name} 弹层必须保留在画面中`).not.toBeNull();
  const below = { left: 0, right: width, top: foreground.y, bottom: height };
  if (!box) return [below];
  const rectangle = screenshotRectangle(box, clip, size);
  const { left, right, bottom } = rectangle;
  const top = Math.max(foreground.y, rectangle.top);
  if (right <= left || bottom <= top) return [below];
  return [
    { ...below, bottom: top }, { left: 0, right: left, top, bottom },
    { left: right, right: width, top, bottom }, { ...below, top: bottom },
  ];
}

/**
 * 取得原有背景排除区域，并保留区域必须存在且不遮挡主体的断言。
 * @param size - 实际截图大小。
 * @param options - 原有背景定位器及裁切设置。
 * @param subjects - 动画主体位置。
 * @param name - 动画名称。
 */
async function backgroundRegions(size: { width: number; height: number }, options: PartialComparisonOptions,
  subjects: Rectangle[], name: string) {
  const excluded: ExcludedPixelRectangle[] = [];
  for (const background of options.excludedBackground || []) {
    const box = await locatorRectangle(background);
    expect(box, `${name} 背景排除区域必须存在`).not.toBeNull();
    for (const subject of subjects) {
      expect(box!.x + box!.width <= subject.x || subject.x + subject.width <= box!.x
        || box!.y + box!.height <= subject.y || subject.y + subject.height <= box!.y,
      `${name} 背景排除区域不能遮住弹层`).toBe(true);
    }
    excluded.push(screenshotRectangle(box!, options.clip, size));
  }
  return excluded;
}

/**
 * 取得局部比较原有的排除区域，稳定性与基准比较共用相同区域及几何断言。
 * @param frame - 本次实际截图。
 * @param options - 原有裁切、前景或背景排除设置。
 * @param subjects - 采样时记录的动画主体位置。
 * @param name - 动画名称，入场仍要求弹层存在。
 */
export async function timelineExcludedRegions(frame: Buffer, options: PartialComparisonOptions,
  subjects: Rectangle[], name: string): Promise<ExcludedPixelRectangle[]> {
  const size = PNG.sync.read(frame);
  if (options.foregroundBelow) return foregroundRegions(size, options.foregroundBelow, options.clip, name);
  return backgroundRegions(size, options, subjects, name);
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
