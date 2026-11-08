/** 离线验证取消响应晚到时仍能完成退场，真实取消失败不能通过。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';
import { expectDismissed } from './popups';
import { press } from './appSession';

const markup = `<div id="popup"><button data-testid="cancel">Cancel</button></div>
  <script>
    document.querySelector('button').onclick = async () => {
      document.body.dataset.cancel = 'requested';
      const result = await new Promise(resolve => {
        window.addEventListener('cancel-result', event => resolve(event.detail), { once: true });
      });
      document.body.dataset.response = 'received';
      if (result.ok) requestAnimationFrame(() => {
        setTimeout(() => { document.querySelector('#popup').hidden = true; }, 32);
      });
    };
  </script>`;

/**
 * 用异步事件模拟晚到的取消结果，保留实际按钮、渲染回调与暂停时钟。
 * @param page - 当前离线浏览器页面。
 */
async function preparePopup(page: Page): Promise<void> {
  await page.setContent(markup);
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await press(page, 'cancel');
  await expect(page.locator('body')).toHaveAttribute('data-cancel', 'requested');
}

/**
 * 在关闭等待期间释放取消结果，不直接改变弹层或推进时钟。
 * @param page - 正在等待取消结果的页面。
 * @param ok - 本次取消是否成功。
 */
async function releaseCancellation(page: Page, ok: boolean): Promise<void> {
  await page.evaluate(/** 向离线页面交回本次异步取消结果。
   * @param ok - 本次取消是否成功。 */ ok => {
    window.dispatchEvent(new CustomEvent('cancel-result', { detail: { ok } }));
  }, ok);
}

test('冻结时钟下晚到的取消响应能完成逐帧退场', /** 验证响应晚于关闭动作且需要渲染回调与定时器时仍能退出。 */ async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await preparePopup(page);
    const target = page.locator('#popup');
    await expect(target).toBeVisible();
    const dismissed = expectDismissed(target);
    await releaseCancellation(page, true);
    await dismissed;
    await expect(target).toBeHidden();
  } finally { await browser.close(); }
});

test('取消失败后仍显示的弹层必须使关闭断言失败', /** 验证推进时钟不能掩盖失败响应或强行隐藏弹层。 */ async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await preparePopup(page);
    await releaseCancellation(page, false);
    await expect(page.locator('body')).toHaveAttribute('data-response', 'received');
    await assert.rejects(expectDismissed(page.locator('#popup')), /关闭后的弹层应卸载、完全透明或移出视口/);
    await expect(page.locator('#popup')).toBeVisible();
  } finally { await browser.close(); }
});
