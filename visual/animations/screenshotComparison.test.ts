import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { areScreenshotsEquivalent } from './screenshotComparison';

/**
 * 构造黑色背景和固定大小的白色块，验证真实像素比较边界。
 * @param blockWidth - 白色块宽度。
 * @param blockHeight - 白色块高度。
 */
function createScreenshot(blockWidth = 0, blockHeight = 0): Buffer {
  const bitmap = new PNG({ width: 100, height: 100 });
  for (let row = 0; row < 100; row++) {
    for (let column = 0; column < 100; column++) {
      const offset = (row * 100 + column) * 4;
      const color = row < blockHeight && column < blockWidth ? 255 : 0;
      bitmap.data.set([color, color, color, 255], offset);
    }
  }
  return PNG.sync.write(bitmap);
}

test('恰好达到 0.5% 差异上限的相邻截图仍稳定，超过上限则不稳定', () => {
  const background = createScreenshot();
  assert.equal(areScreenshotsEquivalent(background, createScreenshot(25, 2)), true, '一万像素中五十个差异应通过');
  assert.equal(areScreenshotsEquivalent(background, createScreenshot(51, 1)), false, '一万像素中五十一个差异应失败');
  assert.equal(areScreenshotsEquivalent(background, createScreenshot(25, 2), 5000), false,
    '排除一半区域后，不得继续使用全图面积放宽稳定性');
});

test('相同画面的不同 PNG 编码仍稳定，尺寸不同始终不稳定', () => {
  const original = createScreenshot(10, 10);
  const bitmap = PNG.sync.read(original);
  const reencoded = PNG.sync.write(bitmap, { deflateLevel: 0 });
  assert.equal(original.equals(reencoded), false);
  assert.equal(areScreenshotsEquivalent(original, reencoded), true);
  const differentSize = PNG.sync.write(new PNG({ width: 101, height: 100 }));
  assert.equal(areScreenshotsEquivalent(original, differentSize), false);
});
