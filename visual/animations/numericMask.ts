import { expect, type Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { remainingPixelCount, type ExcludedPixelRectangle } from '../screenshotComparisonConfiguration';
import type { CaptureArea } from './timeline';

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
    const boxes = await mask.locator.evaluateAll(nodes => nodes.map(node => {
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
      const left = Math.max(0, Math.floor(box.x - (clip?.x || 0)));
      const right = Math.min(bitmap.width, Math.ceil(box.x + box.width - (clip?.x || 0)));
      const top = Math.max(0, Math.floor(box.y - (clip?.y || 0)));
      const bottom = Math.min(bitmap.height, Math.ceil(box.y + box.height - (clip?.y || 0)));
      if (right <= left || bottom <= top) continue;
      excluded.push({ left, right, top, bottom });
      for (let row = top; row < bottom; row++) {
        for (let column = left; column < right; column++) {
          bitmap.data.set([255, 0, 255, 255], (row * bitmap.width + column) * 4);
        }
      }
    }
  }
  return { png: PNG.sync.write(bitmap), comparedPixels: remainingPixelCount(bitmap.width, bitmap.height, excluded) };
}
