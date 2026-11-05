/** 仅注入真实 HTTP 500／503，观察原提示是否出现并验证真实恢复。 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { withTable } from './table';
import { capture } from './capture';

type Observation = { source: string; status: number; requestId: string; path: string };
type FaultState = { enabled: boolean; events: Observation[] };

/**
 * 从可见座位提交真实带入；已存在的错误弹窗只能通过原按钮关闭。
 * @param page - 当前真实牌桌。
 */
async function submitBuyIn(page: Page): Promise<void> {
  const dismiss = page.getByTestId('common-alert-button-undefined').filter({ visible: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByTestId('in-game-container-seat').first().click();
  await expect(page.getByTestId('buy-in-confirm-button')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('buy-in-confirm-button').click();
}

for (const status of [500, 503]) {
  for (const format of ['json', 'html']) {
    test(`HTTP ${status} ${format}：记录真实提示并解除故障重试`, /**
     * 在原应用错误处理链中观察 5xx，不注入筹码不足文案。
     * @param fixtures - 真实账号、页面和专用代理。
     * @param information - 本例输出与附件。
     */ async ({ page, newAccount, serverErrors }, information) => {
      await withTable(page, newAccount, /**
       * 仅对本次创建的房间启用故障并观察真实恢复。
       * @param roomId - 创建响应返回的准确房间。 */ async (roomId) => {
        const target = `/v10/texas_holdem/room/${roomId}/buy_in/apply`;
        await serverErrors.command('server-errors', {
          path: target, method: 'POST', status, format,
          fingerprint: createHash('sha256').update(newAccount.authorization.replace(/^bearer\s+/i, '')).digest('hex'),
        });
        try {
          const response = page.waitForResponse(/** 记录浏览器实际收到的目标 HTTP 状态。
           * @param received - 当前网络响应。 */ received => new URL(received.url()).pathname === target
            && received.request().method() === 'POST');
          await submitBuyIn(page);
          expect((await response).status()).toBe(status);
          const notice = page.getByTestId('toastText1').or(page.getByTestId('common-alert-message'))
            .or(page.getByTestId('alert-message-text')).filter({ visible: true }).first();
          await expect.soft(notice, '5xx 应显示可读错误，不能静默失败').toBeVisible({ timeout: 10_000 });
          const message = await notice.isVisible() ? await notice.textContent() : null;
          const originalMessageReproduced = /玩家筹码不足-sit/.test(message || '');
          await writeFile(information.outputPath('observed-error.json'), JSON.stringify({
            status, format, message, originalMessageReproduced,
            scope: '真实 Web 的 HTTP 带入边界；不代表历史入座 RPC 的完整根因',
          }, null, 2));
          expect.soft(message || '', '不得显示 undefined 或将 5xx 误报为余额不足')
            .not.toMatch(/undefined|筹码不足|余额不足/);
          await capture(page, information.outputPath('5xx.png'));
          await expect(page.getByTestId('buy-in-confirm-button')).not.toBeVisible();
          await submitBuyIn(page);
          await expect.poll(/** 检查故障期间第二次操作也命中同一 5xx。 */ async () => {
            const state = await serverErrors.command<FaultState>('server-errors');
            return state.events.filter(/** 仅统计本例注入的服务器响应。
             * @param event - 脱敏请求事件。 */ event => event.source === 'injected-5xx').length;
          }).toBeGreaterThanOrEqual(2);
          await expect(page.getByTestId('buy-in-confirm-button')).not.toBeVisible();
          await serverErrors.command('server-errors', { enabled: false });
          await submitBuyIn(page);
          await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeVisible({ timeout: 30_000 });
          await expect(page.getByTestId('text-holdem-own-balance-text')).toHaveText('100');
          await expect(page.getByTestId('texas-holdem-buy-in-popup-visible-marker')).toHaveCount(0);
          await expect.poll(/** 恢复必须收到真实成功响应，不能仅凭本地状态变化。 */ async () => {
            const state = await serverErrors.command<FaultState>('server-errors');
            return state.events.some(/** 只接受透传上游的成功状态。
             * @param event - 脱敏请求事件。 */ event => event.source === 'upstream' && event.status < 300);
          }).toBe(true);
          await capture(page, information.outputPath('recovered.png'));
        } finally {
          await serverErrors.command('server-errors', { enabled: false });
          const state = await serverErrors.command<FaultState>('server-errors');
          await writeFile(information.outputPath('http-events.json'), JSON.stringify(state, null, 2));
        }
      });
    });
  }
}
