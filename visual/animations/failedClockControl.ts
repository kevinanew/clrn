/** 仅在原断言失败后区分冻结时钟的未提交更新与持续的业务失败。 */
import type { Page, TestInfo } from '@playwright/test';

const markers = ['club_tab_room', 'club_tab_my_club', 'club-rooms-empty-title',
  'common-alert-container', 'common-alert-button-retry', 'alert-custom-button',
  'game-splash-screen-bg', 'texas-holdem-show-remain-community-card-button'];

/**
 * 保存失败现场及额外两帧后的状态；不点击、不重试断言，诊断异常不得覆盖原异常。
 * @param page - 已失败的页面。
 * @param info - 原测试附件位置。
 * @param enabled - 仅本轮失败场景启用。
 */
export async function saveFailedClockControl(page: Page, info: TestInfo, enabled = true): Promise<void> {
  if (!enabled) return;
  try {
    const before = await clockState(page);
    await info.attach('failed-clock-before', { body: JSON.stringify(before), contentType: 'application/json' });
    await info.attach('failed-clock-original', {
      body: await page.screenshot({ timeout: 5000 }), contentType: 'image/png',
    });
    await page.clock.runFor(32);
    const after = await clockState(page);
    await info.attach('failed-clock-after-32ms', { body: JSON.stringify(after), contentType: 'application/json' });
  } catch { /* 诊断失败不改变原用例结果。 */ }
}

/**
 * 只读取白名单控件的布局、透明度和中心命中标记，不保存页面正文或业务标识。
 * @param page - 已失败的页面。
 */
async function clockState(page: Page) {
  return page.evaluate(
    /**
     * 在一次 DOM 读取中保留实际呈现状态。
     * @param ids - 固定控件白名单。
     */
    ids => ({ time: Date.now(), controls: ids.flatMap(
      /**
       * 只检查固定测试标记的所有副本。
       * @param id - 白名单标记。
       */
      id => Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).map(
        /**
         * 不读取文字、属性全集或任意祖先标识。
         * @param node - 当前控件。
         */
        node => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { id, rect: rect.toJSON(), opacity: style.opacity, visibility: style.visibility,
            pointerEvents: style.pointerEvents, hitSelf: Boolean(hit && node.contains(hit)) };
        },
      ),
    ) }), markers,
  );
}
