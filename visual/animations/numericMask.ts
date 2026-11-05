import { expect, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { remainingPixelCount, type ExcludedPixelRectangle } from '../screenshotComparisonConfiguration';
import type { CaptureArea } from './captureTypes';

export type NumericTextMask = { container: Locator; locator: Locator; expectedCount: number };

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
    if (await mask.container.count() === 0) continue;
    const boxes = await mask.locator.evaluateAll(/** 在页面中读取数字遮罩元素的实际样式、边界与累计透明度。
 * @param nodes - 当前匹配的页面节点集合。 */ nodes => nodes.map(/** 汇总当前节点及祖先的可见性、透明度与布局，供遮罩断言使用。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      let opacity = 1;
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (ancestorStyle.visibility === 'hidden' || ancestorStyle.display === 'none') opacity = 0;
        opacity *= Number(ancestorStyle.opacity);
      }
      // getBoundingClientRect 已包含入退场位移和缩放；阴影边距也使用相同缩放比例。
      const scaleX = rect.width / (parseFloat(style.width) || 1);
      const scaleY = rect.height / (parseFloat(style.height) || 1);
      return { x: rect.x - 4 * scaleX, y: rect.y - 4 * scaleY,
        width: rect.width + 8 * scaleX, height: rect.height + 8 * scaleY, opacity };
    }));
    expect(boxes, '所属控件存在时，金币和钻石数字节点必须完整').toHaveLength(mask.expectedCount);
    for (const box of boxes) {
      if (box.opacity === 0) continue;
      const rectangle = maskRectangle(bitmap, box, clip);
      if (rectangle) excluded.push(rectangle);
    }
  }
  return { png: PNG.sync.write(bitmap), comparedPixels: remainingPixelCount(bitmap.width, bitmap.height, excluded) };
}

/**
 * 将可见数字区域裁切到截图范围并填入固定颜色。
 * @param bitmap - 截图像素。
 * @param box - 页面中的数字边界。
 * @param clip - 截图裁切区域。
 */
function maskRectangle(bitmap: PNG, box: { x: number; y: number; width: number; height: number }, clip?: CaptureArea) {
  const offset = clip || { x: 0, y: 0 };
  const left = Math.max(0, Math.floor(box.x - offset.x));
  const right = Math.min(bitmap.width, Math.ceil(box.x + box.width - offset.x));
  const top = Math.max(0, Math.floor(box.y - offset.y));
  const bottom = Math.min(bitmap.height, Math.ceil(box.y + box.height - offset.y));
  if (right <= left || bottom <= top) return undefined;
  for (let row = top; row < bottom; row++) {
    for (let column = left; column < right; column++) {
      bitmap.data.set([255, 0, 255, 255], (row * bitmap.width + column) * 4);
    }
  }
  return { left, right, top, bottom };
}
