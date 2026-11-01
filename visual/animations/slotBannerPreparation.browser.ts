/** 用真实浏览器的定时器和 RAF 验证旋转起点，覆盖旧帧与下一轮定时器重叠。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { prepareSlotBannerTimeline } from './slotBannerPreparation';

test('当前旋转处于不同阶段时，下一轮首帧、运动和重复周期均保持一致', async () => {
  const browser = await chromium.launch();
  try {
    for (const offset of [0, 16, 160, 640, 992, 1200]) {
      const page = await browser.newPage();
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
      // 使用原始页面脚本，避免 tsx 的函数命名辅助代码进入浏览器。
      await page.setContent(`<div id="reel"></div><script>
        const reel = document.getElementById('reel');
        /** 每次旋转重置滚轴，保留上一轮尚未调用的原生 RAF。 */
        const spin = () => {
          reel.style.transform = 'translateY(-300px)';
          const start = Date.now();
          /** 根据实际经过时间绘制，结束后停止申请 RAF。 */
          const frame = () => {
            const remaining = Math.max(0, 1 - (Date.now() - start) / 1000);
            reel.style.transform = 'translateY(' + (-300 * remaining) + 'px)';
            if (remaining > 0) requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
          setTimeout(spin, 4000);
        };
        spin();
      </script>`);
      await page.clock.runFor(offset);
      await prepareSlotBannerTimeline(page);
      const reel = page.locator('#reel');
      assert.equal(await reel.getAttribute('style'), 'transform: translateY(-300px);', `准备阶段偏移 ${offset}ms`);
      await page.clock.runFor(160);
      const translation = await reel.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42);
      assert.ok(translation > -300 && translation < 0, '160ms 必须处于运动中，不能停在首帧或直接跳到终帧');
      await page.clock.runFor(1040);
      assert.equal(await reel.getAttribute('style'), 'transform: translateY(0px);', '旋转必须完整结束');
      await page.clock.runFor(2800);
      assert.equal(await reel.getAttribute('style'), 'transform: translateY(-300px);', '4000ms 时必须开始下一轮');
      await page.close();
    }
  } finally { await browser.close(); }
});
