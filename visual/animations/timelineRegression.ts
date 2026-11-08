import { expect, test, type Page, type Locator } from '@playwright/test';
import { captureTimeline } from './timeline';
import { PNG } from 'pngjs';

// 由 timeline.browser.ts 使用临时基准和报告运行，不进入真实账号动画套件。
const comparison = process.env.ANIMATION_CAPTURE_COMPARISON === 'true';

for (const mode of ['ordinary', 'foreground', 'background', 'numeric'] as const) {
  test(`截图差异继续采集全部阶段：${mode}`, /** 验证截图差异继续采集全部阶段：$\{mode\}。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param information - 当前操作使用的 information。 */ async ({ page }, information) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.setContent(`<style>
      body { margin: 0; background: ${comparison ? '#0044ff' : '#ff4400'}; }
      #subject { position: absolute; top: 10px; left: 10px; width: 30px; height: 30px; background: white; }
      #background { position: absolute; top: 100px; width: 200px; height: 20px; }
      #number { position: absolute; top: 60px; width: 150px; height: 24px;
        text-align: center; font: 16px sans-serif; }
    </style><div id="subject"></div><div id="background"></div><div id="number">60</div>`);
    await page.evaluate(/** 安装持续横向移动的元素，验证时间线能识别画面仍在变化。 */ () => {
      let position = 10;
      setInterval(/** 每帧向右移动测试目标，制造持续的布局变化。 */ () => { document.getElementById('subject')!.style.left = `${position += 2}px`; }, 16);
    });
    const subject = page.locator('#subject');
    const options = {
      times: [0, 80], requireMotion: true,
      ...comparisonOptions(mode, page, subject, 80),
    };
    await captureTimeline(page, information, `${mode}-first`, subject, options);
    await captureTimeline(page, information, `${mode}-second`, subject, options);
    await information.attach('全部阶段已完成', { body: '已完成', contentType: 'text/plain' });
  });
}

test('业务断言失败仍中止后续阶段', /** 验证业务断言失败仍中止后续阶段。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param information - 当前操作使用的 information。 */ async ({ page }, information) => {
  await page.setContent('<div>实际状态</div>');
  if (comparison) await expect(page.locator('div')).toHaveText('预期状态', { timeout: 100 });
  await information.attach('业务断言之后', { body: '不应继续', contentType: 'text/plain' });
});

test('页面采集失败仍中止后续阶段', /** 验证页面采集失败仍中止后续阶段。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param information - 当前操作使用的 information。 */ async ({ page }, information) => {
  if (comparison) {
    await page.close();
    await captureTimeline(page, information, 'closed-page', page.locator('div'));
  }
  await information.attach('页面关闭之后', { body: '不应继续', contentType: 'text/plain' });
});

for (const mode of ['tolerated', 'unstable'] as const) {
  for (const kind of ['ordinary', 'foreground', 'background', 'numeric', 'mask'] as const) {
    test(`相邻截图稳定性：${mode}/${kind}`, /** 验证相邻截图稳定性：$\{mode\}/$\{kind\}。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param information - 当前操作使用的 information。 */ async ({ page }, information) => {
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
      await page.setContent(`<div id="subject" style="width:30px;height:30px;background:red"></div>
        <div id="background" style="position:absolute;top:100px;width:200px;height:20px"></div>
        <div id="number" style="position:absolute;top:60px;width:150px;height:24px;text-align:center;font:16px sans-serif">60</div>`);
      if (comparison) {
        const takeScreenshot = page.screenshot.bind(page);
        let alternate = false;
        const changedPixels = { tolerated: 1, unstable: 200 }[mode];
        /**
         * 给真实截图注入交替的微小绘制差异或明显变化，避免依赖宿主是否恰好出现噪点。
         * @param options - 生产采样器传入的截图设置。
         */
        page.screenshot = /** 交替修改截图像素，验证比较器区分容忍范围与真实变化。
 * @param options - 当前操作使用的 options。 */ async options => {
          const bitmap = PNG.sync.read(await takeScreenshot(options));
          alternate = !alternate;
          const color = alternate ? 0 : 255;
          for (let pixel = 0; pixel < changedPixels; pixel++) {
            bitmap.data.set([color, color, color, 255], pixel * 4);
          }
          return PNG.sync.write(bitmap);
        };
      }
      await captureTimeline(page, information, `${mode}-${kind}`, page.locator('#subject'), {
        times: [0, 80], requireChange: false,
        ...comparisonOptions(kind, page, page.locator('#subject'), 80),
      });
      await information.attach('稳定性检查之后', { body: '已完成', contentType: 'text/plain' });
    });
  }
}

for (const kind of ['foreground', 'background'] as const) {
  for (const mode of ['boundary', 'over-boundary', 'excluded-only'] as const) {
    test(`局部稳定性有效面积：${mode}/${kind}`, /** 验证局部稳定性有效面积：$\{mode\}/$\{kind\}。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param information - 当前操作使用的 information。 */ async ({ page }, information) => {
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
      await page.setContent(`<style>body { margin: 0; background: white; }
        #subject { position: absolute; ${kind === 'foreground'
          ? 'top: 40px; left: 50px; width: 100px; height: 20px;'
          : 'top: 5px; left: 5px; width: 10px; height: 10px;'} background: red; }
        #background { position: absolute; top: 50px; width: 200px; height: 70px; }</style>
        <div id="subject"></div><div id="background"></div>`);
      if (comparison) injectPartialNoise(page, mode);
      await captureTimeline(page, information, `${mode}-${kind}`, page.locator('#subject'), {
        times: [0, 80], requireChange: false,
        ...comparisonOptions(kind, page, page.locator('#subject'), 40),
      });
      await information.attach('局部稳定性检查之后', { body: '已完成', contentType: 'text/plain' });
    });
  }
}

for (const kind of ['missing-background', 'overlapping-background', 'missing-foreground'] as const) {
  test(`局部几何错误仍失败：${kind}`, /** 验证局部几何错误仍失败：$\{kind\}。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param information - 当前操作使用的 information。 */ async ({ page }, information) => {
    if (comparison) {
      await page.setContent('<div id="subject" style="width:30px;height:30px;background:red"></div>');
      const subject = page.locator('#subject');
      await captureTimeline(page, information, 'geometry-enter', subject, {
        times: [0], requireChange: false,
        ...geometryOptions(kind, page, subject),
      });
    }
    await information.attach('几何断言之后', { body: '不应继续', contentType: 'text/plain' });
  });
}

/**
 * 每种比较方式明确保留原定位器、数字数量和分界线。
 * @param mode - 原比较方式。
 * @param page - 本地夹具页面。
 * @param subject - 实际主体。
 * @param y - 原前景分界线。
 */
function comparisonOptions(mode: string, page: Page, subject: Locator, y: number) {
  const options = {
    ordinary: {},
    foreground: { foregroundBelow: { y, locator: subject } },
    background: { excludedBackground: [page.locator('#background')] },
    numeric: { numericMask: [{ container: page.locator('body'), locator: page.locator('#number'), expectedCount: 1 }] },
    mask: { mask: [page.locator('#background')] },
  };
  return options[mode as keyof typeof options];
}

/**
 * 几何错误使用明确场景表，保留缺失前景与重叠背景的原硬断言。
 * @param kind - 几何错误场景。
 * @param page - 本地夹具页面。
 * @param subject - 实际主体。
 */
function geometryOptions(kind: string, page: Page, subject: Locator) {
  const options = {
    'missing-foreground': { foregroundBelow: { y: 80, locator: page.locator('#missing') } },
    'missing-background': { excludedBackground: [page.locator('#missing')] },
    'overlapping-background': { excludedBackground: [subject] },
  };
  return options[kind as keyof typeof options];
}

/**
 * 在相同的有效区域边界制造五十／五十一个差异，或仅改变排除区域。
 * @param page - 本地夹具页面。
 * @param mode - 原边界场景。
 */
function injectPartialNoise(page: Page, mode: 'boundary' | 'over-boundary' | 'excluded-only') {
  const takeScreenshot = page.screenshot.bind(page);
  let alternate = false;
  const changedPixels = { 'excluded-only': 200, boundary: 50, 'over-boundary': 51 }[mode];
  const startRow = mode === 'excluded-only' ? 80 : 20;
  /**
   * 一万有效像素中的五十／五十一个差异，或仅发生在排除区域中的变化。
   * @param options - 实际采样器的截图设置。
   */
  page.screenshot = /** 在排除区域与阈值边界附近修改像素，验证部分截图比较策略。
 * @param options - 当前操作使用的 options。 */ async options => {
    const bitmap = PNG.sync.read(await takeScreenshot(options));
    alternate = !alternate;
    const color = alternate ? 0 : 255;
    for (let pixel = 0; pixel < changedPixels; pixel++) {
      const row = startRow + Math.floor(pixel / 20);
      const offset = (row * bitmap.width + 20 + pixel % 20) * 4;
      bitmap.data.set([color, color, color, 255], offset);
    }
    return PNG.sync.write(bitmap);
  };
}
