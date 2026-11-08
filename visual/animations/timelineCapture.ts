import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { imageComparisonOptions, remainingPixelCount, type ExcludedPixelRectangle } from '../screenshotComparisonConfiguration';
import { hasNormalCardSpriteClock } from './cardSpriteClock';
import { areScreenshotsEquivalent } from './screenshotComparison';
import { clipOffset, preparePartialComparison, timelineExcludedRegions } from './timelineComparison';
import { maskNumericFields } from './numericMask';
import type { CaptureArea } from './captureTypes';
import type { TimelineElement, TimelineOptions } from './timelineTypes';

/**
 * 计算普通截图中原有定位器遮罩以外的有效面积，不改变浏览器实际绘制的遮罩。
 * @param frame - 已采集的完整截图。
 * @param masks - 原有截图遮罩定位器。
 * @param clip - 截图的原有裁切范围。
 */
async function unmaskedPixelCount(frame: Buffer, masks?: Locator[], clip?: CaptureArea) {
  if (!masks?.length) return undefined;
  return maskedArea(frame, masks, clip);
}

/**
 * 按定位器遮罩矩形的并集扣除面积。
 * @param frame - 原图。
 * @param masks - 非空遮罩集合。
 * @param clip - 原裁切区域。
 */
async function maskedArea(frame: Buffer, masks: Locator[], clip: CaptureArea | undefined) {
  const bitmap = PNG.sync.read(frame);
  const excluded: ExcludedPixelRectangle[] = [];
  for (const mask of masks) {
    const boxes = await mask.evaluateAll(/** 读取遮罩节点的布局边界，供时间线截图排除区域使用。
 * @param nodes - 当前匹配的页面节点集合。 */ nodes => nodes.map(/** 将当前遮罩的 DOM 边界转换为普通坐标对象。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const x = clipOffset(clip, 'x'), y = clipOffset(clip, 'y');
    excluded.push(...boxes.map(/** 按原向外取整规则转换每个定位器遮罩矩形。
     * @param box - 原节点矩形。 */ box => ({
      left: Math.floor(box.x - x), right: Math.ceil(box.x + box.width - x),
      top: Math.floor(box.y - y), bottom: Math.ceil(box.y + box.height - y),
    })));
  }
  return remainingPixelCount(bitmap.width, bitmap.height, excluded);
}

/**
 * 采集一个固定时刻的画面，各比较分支保留相同的稳定性、缺图及尺寸断言。
 * @param page - 虚拟时钟已暂停的页面。
 * @param info - 当前测试的基准路径和附件上下文。
 * @param name - 动画名称。
 * @param options - 原有截图、遮罩与局部区域设置。
 * @param snapshot - 此时刻对应的基准名称。
 * @param elements - 当前记录的动画主体位置。
 */
export async function captureFrame(page: Page, info: TestInfo, name: string, options: TimelineOptions,
  snapshot: string, elements: TimelineElement[]): Promise<Buffer> {
  if (options.numericMask) return captureNumericFrame(page, info, name, options, snapshot);
  if (hasPartialRegions(options)) return capturePartialFrame(page, info, name, options, snapshot, elements);
  // 截图、稳定性与资源失败仍立即中止；像素差异继续后续采样。
  const captured = await captureOrdinaryFrame(page, options, snapshot);
  await saveOrCompareFrame(captured.frame, info, snapshot, options, captured.comparedPixels);
  return captured.frame;
}

/**
 * 判断局部比较是否使用前景或背景排除。
 * @param options - 原截图选项。
 */
function hasPartialRegions(options: TimelineOptions) {
  if (options.foregroundBelow) return true;
  return Boolean(options.excludedBackground?.length);
}

/**
 * 保留截图动画、光标及 CSS 像素缩放选项。
 * @param options - 原裁切和定位器遮罩。
 */
function screenshotSettings(options: TimelineOptions) {
  return { clip: options.clip, mask: options.mask, animations: 'allow' as const,
    caret: 'hide' as const, scale: 'css' as const };
}

/**
 * 判断显式更新模式，普通比较不得创建替代图。
 * @param update - Playwright 更新模式。
 */
function updatesSnapshots(update: TestInfo['config']['updateSnapshots']) {
  return update === 'all' || update === 'changed';
}

/**
 * 数字遮罩稳定后保存未遮罩证据，并比较原有效面积。
 * @param page - 暂停的页面。
 * @param info - 报告上下文。
 * @param name - 动画名称。
 * @param options - 原遮罩与裁切。
 * @param snapshot - 原基准名称。
 */
async function captureNumericFrame(page: Page, info: TestInfo, name: string, options: TimelineOptions, snapshot: string) {
  const screenshotOptions = screenshotSettings(options);
  let original: Buffer = Buffer.alloc(0);
  let masked: Buffer = Buffer.alloc(0);
  let comparedPixels = 0;
  await expect.poll(/** 连续截取并遮罩数字区域，等待其余画面达到稳定。 */ async () => {
    const previousFrame = await page.screenshot(screenshotOptions);
    original = await page.screenshot(screenshotOptions);
    const previousMasked = await maskNumericFields(previousFrame, options.numericMask!, options.clip);
    const current = await maskNumericFields(original, options.numericMask!, options.clip);
    masked = current.png;
    comparedPixels = current.comparedPixels;
    return areScreenshotsEquivalent(masked, previousMasked.png, Math.min(comparedPixels, previousMasked.comparedPixels));
  }, { message: `${name} 数字以外的画面应稳定` }).toBe(true);
  await info.attach(`${snapshot}-unmasked`, { body: original, contentType: 'image/png' });
  const frame = masked;
  const update = info.config.updateSnapshots;
  const comparison = imageComparisonOptions(0.1, comparedPixels);
  expect.soft(frame).toMatchSnapshot(snapshot, updatesSnapshots(update)
    ? { ...comparison, maxDiffPixels: 0 } : comparison);
  return frame;
}

/**
 * 局部稳定性和最终比较共用排除区域，报告保存完整截图。
 * @param page - 暂停的页面。
 * @param info - 报告上下文。
 * @param name - 动画名称。
 * @param options - 原局部比较参数。
 * @param snapshot - 原基准名称。
 * @param elements - 动画主体位置。
 */
async function capturePartialFrame(page: Page, info: TestInfo, name: string, options: TimelineOptions,
  snapshot: string, elements: TimelineElement[]) {
  const screenshotOptions = screenshotSettings(options);
  let frame: Buffer = Buffer.alloc(0);
  let excluded: ExcludedPixelRectangle[] = [];
  await expect.poll(/** 连续采集部分截图并计算排除区域，等待有效比较画面稳定。 */ async () => {
    const previousFrame = await page.screenshot(screenshotOptions);
    frame = await page.screenshot(screenshotOptions);
    excluded = await timelineExcludedRegions(frame, options, elements, name);
    const comparison = preparePartialComparison(frame, previousFrame, excluded);
    return areScreenshotsEquivalent(comparison.png, previousFrame, comparison.comparedPixels);
  }, { message: `${name} 首帧画面应稳定` }).toBe(true);
  comparePartialFrame(frame, info, snapshot, excluded);
  return frame;
}

/**
 * 缺图使用软断言；已有图先检查尺寸，再比较有效面积。
 * @param frame - 完整实际截图。
 * @param info - 基准上下文。
 * @param snapshot - 原基准名称。
 * @param excluded - 原排除区域。
 */
function comparePartialFrame(frame: Buffer, info: TestInfo, snapshot: string, excluded: ExcludedPixelRectangle[]) {
  const snapshotPath = info.snapshotPath(snapshot, { kind: 'screenshot' });
  const update = info.config.updateSnapshots;
  if (updatesSnapshots(update) || !existsSync(snapshotPath)) {
    // 显式生成候选基准时保存完整画面，不能依赖旧图或写入拼接后的比较图。
    // 普通比较缺少基准时由软断言报告，不能先读文件中止后续采样。
    expect.soft(frame).toMatchSnapshot(snapshot, imageComparisonOptions(0.1));
  } else {
    const reference = readFileSync(snapshotPath);
    const actual = PNG.sync.read(frame);
    const expected = PNG.sync.read(reference);
    expect([actual.width, actual.height], `${snapshot} 基准尺寸`).toEqual([expected.width, expected.height]);
    const comparison = preparePartialComparison(frame, reference, excluded);
    expect.soft(comparison.png).toMatchSnapshot(snapshot, imageComparisonOptions(0.1, comparison.comparedPixels));
  }
}

/**
 * 相同时刻检查普通画面稳定；正常时间对照只取证，不能要求运动画面停住。
 * @param page - 当前页面。
 * @param options - 原截图及定位器遮罩参数。
 * @param snapshot - 证据或基准名。
 */
async function captureOrdinaryFrame(page: Page, options: TimelineOptions, snapshot: string) {
  const screenshotOptions = screenshotSettings(options);
  if (options.observeFrames && hasNormalCardSpriteClock(page)) {
    return { frame: await page.screenshot(screenshotOptions), comparedPixels: undefined };
  }
  let frame: Buffer = Buffer.alloc(0);
  let comparedPixels: number | undefined;
  await expect.poll(/** 连续比较未遮罩像素，等待时间线采样画面收敛。 */ async () => {
    const previousFrame = await page.screenshot(screenshotOptions);
    frame = await page.screenshot(screenshotOptions);
    comparedPixels = await unmaskedPixelCount(frame, options.mask, options.clip);
    return areScreenshotsEquivalent(frame, previousFrame, comparedPixels);
  }, { message: `${snapshot} 同一虚拟时刻的画面应稳定` }).toBe(true);
  return { frame, comparedPixels };
}

/**
 * 独立取证保存帧；普通比较保持原门槛及软失败，不创建替代基准。
 * @param frame - 实际画面。
 * @param info - 报告上下文。
 * @param snapshot - 原基准名称。
 * @param options - 是否为显式独立取证。
 * @param comparedPixels - 原有遮罩后的比较面积。
 */
async function saveOrCompareFrame(frame: Buffer, info: TestInfo, snapshot: string,
  options: TimelineOptions, comparedPixels?: number) {
  if (options.observeFrames) await info.attach(snapshot, { body: frame, contentType: 'image/png' });
  else expect.soft(frame).toMatchSnapshot(snapshot, imageComparisonOptions(0.1, comparedPixels));
}
