import { expect, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { remainingPixelCount, type ExcludedPixelRectangle } from '../screenshotComparisonConfiguration';
import type { CaptureArea } from './captureTypes';
export type NumericTextMask = {
  container: Locator;
  locator: Locator;
  expectedCount: number;
};
/**
 * 遮住固定宽度的数字文本区及阴影；范围不随余额位数变化，图标和工具栏边缘仍参与比较。
 * @param frame - 供报告保留的原始截图。
 * @param masks - 数字区域及其所属控件；所属控件卸载后不再绘制遮罩。
 * @param clip - 固定截图区域。
 */
export async function maskNumericFields(frame: Buffer, masks: NumericTextMask[], clip?: CaptureArea) {
  const bitmap = PNG.sync.read(frame);
  const excluded: ExcludedPixelRectangle[] = [];
  for (const mask of masks) {
    if (await mask.container.count() === 0)
      continue;
    const boxes = await mask.locator.evaluateAll(numericBoxes);
    expect(boxes, '所属控件存在时，金币和钻石数字节点必须完整').toHaveLength(mask.expectedCount);
    maskBoxes(bitmap, boxes, excluded, clip);
  }
  return { png: PNG.sync.write(bitmap), comparedPixels: remainingPixelCount(bitmap.width, bitmap.height, excluded) };
}
/**
 * 将可见数字区域裁切到截图范围并填入固定颜色。
 * @param bitmap - 截图像素。
 * @param box - 页面中的数字边界。
 * @param clip - 截图裁切区域。
 */
function maskRectangle(bitmap: PNG, box: {
  x: number;
  y: number;
  width: number;
  height: number;
}, clip?: CaptureArea) {
  const offset = clip || { x: 0, y: 0 };
  const left = Math.max(0, Math.floor(box.x - offset.x));
  const right = Math.min(bitmap.width, Math.ceil(box.x + box.width - offset.x));
  const top = Math.max(0, Math.floor(box.y - offset.y));
  const bottom = Math.min(bitmap.height, Math.ceil(box.y + box.height - offset.y));
  if (emptyRectangle(left, right, top, bottom))
    return undefined;
  paintRectangle(bitmap, left, right, top, bottom);
  return { left, right, top, bottom };
}
/**
 * 在浏览器读取数字边界与累计透明度，所有辅助函数一并序列化。
 * @param nodes - 数字文本节点。
 * @returns 含阴影边距的数字区域。
 */
function numericBoxes(nodes: Element[]) {
  const checks = {
    /**
     * 汇总可见祖先透明度。
     * @param node - 数字文本节点。
     * @returns 累计透明度。
     */
    ancestorOpacity(node: Element): number {
      let opacity = 1;
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
        opacity *= checks.visibleOpacity(getComputedStyle(ancestor));
      }
      return opacity;
    },
    /**
     * 隐藏祖先不绘制，其余祖先按实际透明度累计。
     * @param style - 祖先样式。
     * @returns 当前祖先透明度。
     */
    visibleOpacity(style: CSSStyleDeclaration): number {
      const visible = style.visibility === 'hidden' || style.display === 'none' ? 0 : 1;
      return visible * Number(style.opacity);
    }
  };
  return nodes.map(/** 汇总当前节点及祖先的可见性、透明度与布局，供遮罩断言使用。
  * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const opacity = checks.ancestorOpacity(node);
    // getBoundingClientRect 已包含入退场位移和缩放；阴影边距也使用相同缩放比例。
    const scaleX = rect.width / (parseFloat(style.width) || 1);
    const scaleY = rect.height / (parseFloat(style.height) || 1);
    return { x: rect.x - 4 * scaleX, y: rect.y - 4 * scaleY,
      width: rect.width + 8 * scaleX, height: rect.height + 8 * scaleY, opacity };
  });
}
/**
 * 绘制当前控件的可见数字区域。
 * @param bitmap - 截图像素。
 * @param boxes - 数字边界及累计透明度。
 * @param excluded - 实际排除的矩形。
 * @param clip - 截图裁切区域。
 */
function maskBoxes(bitmap: PNG, boxes: {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}[], excluded: ExcludedPixelRectangle[], clip?: CaptureArea): void {
  for (const box of boxes) {
    if (box.opacity === 0)
      continue;
    appendMask(bitmap, box, excluded, clip);
  }
}
/**
 * 仅登记与截图相交的真实遮罩面积。
 * @param bitmap - 截图像素。
 * @param box - 数字边界。
 * @param excluded - 已绘制矩形。
 * @param clip - 截图裁切区域。
 */
function appendMask(bitmap: PNG, box: {
  x: number;
  y: number;
  width: number;
  height: number;
}, excluded: ExcludedPixelRectangle[], clip?: CaptureArea): void {
  const rectangle = maskRectangle(bitmap, box, clip);
  if (rectangle)
    excluded.push(rectangle);
}
/**
 * 判断裁切后的矩形是否没有面积。
 * @param left - 左边界。
 * @param right - 右边界。
 * @param top - 上边界。
 * @param bottom - 下边界。
 * @returns 是否为空。
 */
function emptyRectangle(left: number, right: number, top: number, bottom: number): boolean {
  return right <= left || bottom <= top;
}
/**
 * 将裁切后的矩形逐像素填成固定颜色。
 * @param bitmap - 截图像素。
 * @param left - 左边界。
 * @param right - 右边界。
 * @param top - 上边界。
 * @param bottom - 下边界。
 */
function paintRectangle(bitmap: PNG, left: number, right: number, top: number, bottom: number): void {
  for (let row = top; row < bottom; row++) {
    for (let column = left; column < right; column++) {
      bitmap.data.set([255, 0, 255, 255], (row * bitmap.width + column) * 4);
    }
  }
}
