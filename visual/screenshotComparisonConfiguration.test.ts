import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PNG } from 'pngjs';
import visualConfiguration from './playwright.config';
import animationConfiguration from './animations/playwright.config';
import { imageComparisonOptions, remainingPixelCount } from './screenshotComparisonConfiguration';

// 调用当前锁定版本中截图断言实际使用的比较器，不另写一份判定公式。
const require = createRequire(import.meta.url);
const compare = require('playwright-core/lib/coreBundle').utils.getComparator('image/png') as
  (actual: Buffer, expected: Buffer, options: object) => null | { errorMessage: string };

/**
 * 构造确定数量的有效差异像素，避免字体、抗锯齿或浏览器噪点干扰边界。
 * @param changed - 白色像素数量。
 * @param width - 实际图片宽度。
 * @param color - 差异像素灰度。
 */
function screenshot(changed = 0, width = 100, color = 255): Buffer {
  const bitmap = new PNG({ width, height: 100 });
  for (let pixel = 0; pixel < width * 100; pixel++) bitmap.data.set([0, 0, 0, 255], pixel * 4);
  for (let pixel = 0; pixel < changed; pixel++) {
    const offset = ((20 + Math.floor(pixel / 20)) * width + 20 + pixel % 20) * 4;
    bitmap.data.set([color, color, color, 255], offset);
  }
  return PNG.sync.write(bitmap);
}

const entries = [
  ['静态截图配置', visualConfiguration.expect!.toHaveScreenshot!],
  ['动画截图配置', animationConfiguration.expect!.toHaveScreenshot!],
  ['动画关键帧', imageComparisonOptions(0.1)],
  ['素材图片帧', imageComparisonOptions(0)],
  ['局部有效区域', imageComparisonOptions(0.1, 10_000)],
] as const;

for (const [name, options] of entries) {
  test(`${name}使用真实比较器时，五十个差异像素通过，五十一个失败`, () => {
    const baseline = screenshot();
    assert.equal(compare(screenshot(50), baseline, options), null, '有效面积一万像素，恰好百分之零点五应通过');
    assert.notEqual(compare(screenshot(51), baseline, options), null, '超过百分之零点五必须失败');
    assert.notEqual(compare(screenshot(0, 101), baseline, options), null, '尺寸不同必须失败');
  });
}

test('局部比较不把排除区域计入分母，重叠遮罩只排除一次', () => {
  const compared = remainingPixelCount(200, 100, [
    { left: 100, right: 200, top: 0, bottom: 100 },
    { left: 150, right: 200, top: 0, bottom: 100 },
  ]);
  assert.equal(compared, 10_000, '排除区域的并集为一万像素');
  const baseline = screenshot(0, 200);
  assert.equal(compare(screenshot(50, 200), baseline, imageComparisonOptions(0.1, compared)), null);
  assert.notEqual(compare(screenshot(51, 200), baseline, imageComparisonOptions(0.1, compared)), null,
    '不得按完整的两万像素允许一百个差异');
  assert.throws(() => imageComparisonOptions(0.1, 0), /有效比较面积必须是正整数/);
});

test('静态、动画和素材仍分别保留原单像素颜色容差', () => {
  const baseline = screenshot();
  const subtle = screenshot(1000, 100, 30);
  assert.equal(compare(subtle, baseline, visualConfiguration.expect!.toHaveScreenshot!), null,
    '静态截图继续沿用 Playwright 原有默认颜色容差');
  assert.notEqual(compare(subtle, baseline, imageComparisonOptions(0.1)), null,
    '动画继续使用零点一的颜色容差');
  assert.notEqual(compare(screenshot(1000, 100, 1), baseline, imageComparisonOptions(0)), null,
    '素材帧继续逐像素比较颜色');
});
