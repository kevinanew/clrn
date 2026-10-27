import { expect, test } from '@playwright/test';
import { captureTimeline } from './timeline';

// 由 timeline.browser.ts 使用临时基准和报告运行，不进入真实账号动画套件。
const comparison = process.env.ANIMATION_CAPTURE_COMPARISON === 'true';

for (const mode of ['ordinary', 'foreground', 'background', 'numeric'] as const) {
  test(`截图差异继续采集全部阶段：${mode}`, async ({ page }, information) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.setContent(`<style>
      body { margin: 0; background: ${comparison ? '#0044ff' : '#ff4400'}; }
      #subject { position: absolute; top: 10px; left: 10px; width: 30px; height: 30px; background: white; }
      #background { position: absolute; top: 100px; width: 200px; height: 20px; }
      #number { position: absolute; top: 60px; width: 150px; height: 24px;
        text-align: center; font: 16px sans-serif; }
    </style><div id="subject"></div><div id="background"></div><div id="number">60</div>`);
    await page.evaluate(() => {
      let position = 10;
      setInterval(() => { document.getElementById('subject')!.style.left = `${position += 2}px`; }, 16);
    });
    const subject = page.locator('#subject');
    const options = {
      times: [0, 80], requireMotion: true,
      ...(mode === 'foreground' ? { foregroundBelow: { y: 80, locator: subject } } : {}),
      ...(mode === 'background' ? { excludedBackground: [page.locator('#background')] } : {}),
      ...(mode === 'numeric' ? { finalFrameNumericMask: [{ locator: page.locator('#number'), maximumTexts: ['60'] }] } : {}),
    };
    await captureTimeline(page, information, `${mode}-first`, subject, options);
    await captureTimeline(page, information, `${mode}-second`, subject, options);
    await information.attach('全部阶段已完成', { body: '已完成', contentType: 'text/plain' });
  });
}

test('业务断言失败仍中止后续阶段', async ({ page }, information) => {
  await page.setContent('<div>实际状态</div>');
  if (comparison) await expect(page.locator('div')).toHaveText('预期状态', { timeout: 100 });
  await information.attach('业务断言之后', { body: '不应继续', contentType: 'text/plain' });
});

test('页面采集失败仍中止后续阶段', async ({ page }, information) => {
  if (comparison) {
    await page.close();
    await captureTimeline(page, information, 'closed-page', page.locator('div'));
  }
  await information.attach('页面关闭之后', { body: '不应继续', contentType: 'text/plain' });
});
