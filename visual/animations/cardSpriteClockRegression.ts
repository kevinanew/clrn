/** 由 cardSpriteHistory.browser.ts 通过 Playwright 编译运行，验证正常时间的完整历史采样适配。 */
import { test, expect } from '@playwright/test';
import { useNormalCardSpriteClock } from './cardSpriteClock';
import { captureTimeline, freeze, settleAnimations } from './timeline';

for (const clock of ['normal', 'frozen'] as const) {
  test(`完整历史取证不生成基准且保留运动硬断言：${clock}`, async ({ page }, information) => {
    if (clock === 'normal') {
      useNormalCardSpriteClock(page);
      /** 原生时间路径触碰虚拟时钟时必须立即失败。 */
      const rejectVirtualClock = async () => { throw new Error('unexpected virtual clock'); };
      page.clock.runFor = rejectVirtualClock;
      page.clock.pauseAt = rejectVirtualClock;
      page.clock.fastForward = rejectVirtualClock;
      page.clock.install = rejectVirtualClock;
    } else {
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    }
    await page.setContent('<style>@keyframes move {to {transform:translateX(80px)}}</style>'
      + '<div id="target" style="width:20px;height:20px;background:red;animation:move 2s linear infinite"></div>');
    await freeze(page);
    await settleAnimations(page, 16);
    await captureTimeline(page, information, 'moving', page.locator('#target'), {
      observeFrames: true, times: [0, 160, 320], requireMotion: true,
    });
    expect(information.attachments.filter(item => item.name.endsWith('.png'))).toHaveLength(3);
    const timeline = JSON.parse(String(information.attachments.find(item => item.name === 'moving-timeline')!.body));
    expect(timeline.samples.map((sample: { milliseconds: number }) => sample.milliseconds)).toEqual([0, 160, 320]);
    if (clock === 'normal') {
      expect(await page.evaluate(() => document.getAnimations().map(animation => animation.playState))).toEqual(['running']);
    }
    await page.locator('#target').evaluate(node => { (node as HTMLElement).style.animation = 'none'; });
    await expect(captureTimeline(page, information, 'static', page.locator('#target'), {
      observeFrames: true, times: [0, 80], requireMotion: true,
    })).rejects.toThrow(/主体本身必须移动/);
  });
}
