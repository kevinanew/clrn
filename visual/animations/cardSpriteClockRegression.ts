/** 由 cardSpriteHistory.browser.ts 通过 Playwright 编译运行，验证正常时间的完整历史采样适配。 */
import { test, expect } from '../src/support/diagnosticTest';
import { useNormalCardSpriteClock } from './cardSpriteClock';
import { captureTimeline, freeze, settleAnimations } from './timeline';

for (const clock of ['normal', 'frozen'] as const) {
  test(`完整历史取证不生成基准且保留运动硬断言：${clock}`, /** 验证完整历史取证不生成基准且保留运动硬断言：$\{clock\}。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param information - 当前操作使用的 information。 */ async ({ page }, information) => {
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
    expect(information.attachments.filter(/** 仅保留满足以下条件的条目：`item.name.endsWith('.png')`。
 * @param item - 当前遍历的条目。 */ item => item.name.endsWith('.png'))).toHaveLength(3);
    const timeline = JSON.parse(String(information.attachments.find(/** 查找满足以下条件的首个条目：`item.name === 'moving-timeline'`。
 * @param item - 当前遍历的条目。 */ item => item.name === 'moving-timeline')!.body));
    expect(timeline.samples.map(/** 将当前条目映射为`sample.milliseconds`。
 * @param sample - 当前操作使用的 sample。 */ (sample: { milliseconds: number }) => sample.milliseconds)).toEqual([0, 160, 320]);
    if (clock === 'normal') {
      expect(await page.evaluate(/** 在页面中读取`document.getAnimations().map(animation => animation.playState)`，供测试判断当前界面状态。 */ () => document.getAnimations().map(/** 将当前条目映射为`animation.playState`。
 * @param animation - 当前操作使用的 animation。 */ animation => animation.playState))).toEqual(['running']);
    }
    await page.locator('#target').evaluate(/** 取消目标元素动画，构造静态画面以核验时钟回归检测。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node => { (node as HTMLElement).style.animation = 'none'; });
    await expect(captureTimeline(page, information, 'static', page.locator('#target'), {
      observeFrames: true, times: [0, 80], requireMotion: true,
    })).rejects.toThrow(/主体本身必须移动/);
  });
}
