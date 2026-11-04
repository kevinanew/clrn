/** 验证循环复位与 RAF 相邻时不会被粗步长跳过。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { waitForSeatGuideStart } from './seatGuideReadiness';

test('不同初始相位都能观察到全部引导的真实复位帧，并保留后续运动', async () => {
  const browser = await chromium.launch();
  try {
    for (const offset of [0, 1, 7, 15, 16, 31]) {
      const page = await browser.newPage();
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
      await page.setContent(`<body><script>
        const arrows = Array.from({ length: 9 }, () => {
          const arrow = document.createElement('div');
          arrow.className = 'arrow';
          arrow.style.transform = 'translateY(8px)';
          document.body.append(arrow);
          return arrow;
        });
        const draw = offset => arrows.forEach(arrow => {
          arrow.style.transform = 'translateY(' + offset + 'px)';
        });
        // 复位发生在 RAF 前一毫秒；16ms 步长只会读到下一帧的非零位移。
        const reset = () => {
          draw(0);
          requestAnimationFrame(() => draw(8));
          setTimeout(reset, 64);
        };
        setTimeout(reset, 15);
      </script>`);
      await page.clock.runFor(offset);
      const arrows = page.locator('.arrow');
      await waitForSeatGuideStart(page, arrows);
      assert.deepEqual(await arrows.evaluateAll(nodes => nodes.map(node =>
        new DOMMatrixReadOnly(getComputedStyle(node).transform).m42)), Array(9).fill(0));
      await page.clock.runFor(16);
      assert.deepEqual(await arrows.evaluateAll(nodes => nodes.map(node =>
        new DOMMatrixReadOnly(getComputedStyle(node).transform).m42)), Array(9).fill(8));
      await page.close();
    }
  } finally { await browser.close(); }
});
