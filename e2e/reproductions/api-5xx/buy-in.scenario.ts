/** 仅注入真实 HTTP 500／503，观察原提示是否出现并验证真实恢复。 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { withTable } from './table';
import { capture } from './capture';
import { errorNotice, expectReadableError, expectSeated, submitBuyIn, withNoPageErrors } from './buy-in';
import { clickWithBackgroundClubNotice } from '../../cases/_shared/navigation';
import type { Mitmproxy } from '../../helpers/mitmproxy-client';

type Observation = { source: string; status: number; requestId: string; path: string };
type FaultState = { enabled: boolean; events: Observation[] };

/**
 * 确认真正透传上游的成功请求；正常对照与恢复分别按准确房间匹配。
 * @param proxy - 本轮专用 Python 代理。
 * @param target - 当前房间的准确接口。
 */
async function expectUpstream(proxy: Mitmproxy, target: string): Promise<void> {
  await expect.poll(/** 只接受当前房间真实上游返回的 2xx，不以正常对照冒充恢复。 */ async () => {
    const state = await proxy.command<FaultState>('server-errors');
    return state.events.some(/** 同时核对路径、来源与成功状态。
     * @param event - 脱敏 HTTP 事件。 */ event => event.path === target && event.source === 'upstream'
      && event.status >= 200 && event.status < 300);
  }).toBe(true);
}

/**
 * 每次故障操作都保存实际文案和稳定截图，再按正确行为检查。
 * @param page - 当前真实牌桌。
 * @param information - 本例证据输出。
 * @param status - 指定注入的真实 5xx 状态。
 * @param format - JSON 或 HTML 响应格式。
 * @param attempt - 首次故障或故障中的再次操作。
 */
async function observeError(page: Page, information: TestInfo,
  status: number, format: string, attempt: number): Promise<void> {
  const notice = errorNotice(page);
  await expect.soft(notice, '5xx 应显示可读错误，不能静默失败').toBeVisible({ timeout: 10_000 });
  const message = await notice.isVisible() ? await notice.textContent() : null;
  const suffix = attempt === 1 ? '' : '-retry';
  await writeFile(information.outputPath(`observed-error${suffix}.json`), JSON.stringify({
    status, format, message, originalMessageReproduced: /玩家筹码不足-sit/.test(message || ''),
    scope: '真实 Web 的 HTTP 带入边界；不代表历史入座 RPC 的完整根因',
  }, null, 2));
  expectReadableError(message);
  await capture(page, information.outputPath(`5xx${suffix}.png`));
  await expect(page.getByTestId('buy-in-confirm-button')).not.toBeVisible();
  await expect(page.getByTestId('texas-holdem-buy-in-popup-visible-marker')).toHaveCount(0);
}

for (const status of [500, 503]) {
  for (const format of ['json', 'html']) {
    test(`HTTP ${status} ${format}：记录真实提示并解除故障重试`, /**
     * 在原应用错误处理链中观察 5xx，不注入筹码不足文案。
     * @param fixtures - 真实账号、页面和专用代理。
     * @param information - 本例输出与附件。
     */ async ({ page, newAccount, serverErrors }, information) => {
      const fingerprint = createHash('sha256')
        .update(newAccount.authorization.replace(/^bearer\s+/i, '')).digest('hex');
      await withNoPageErrors(page, /** 对照失败即终止；两间房都由各自的 finally 准确清理。
       * @param check - 注入前确认正常对照没有未处理异常。 */ async check => {
        try {
          await withTable(page, newAccount, /** 先用同一可见入口完成独立正常对照。
           * @param roomId - 对照房间的准确标识。 */ async roomId => {
            const target = `/v10/texas_holdem/room/${roomId}/buy_in/apply`;
            await serverErrors.command('server-errors', {
              path: target, method: 'POST', status, format, fingerprint, enabled: false,
            });
            expect((await submitBuyIn(page, target)).ok(), '故障前同一入口必须真实成功').toBe(true);
            await expectSeated(page);
            await expectUpstream(serverErrors, target);
            await capture(page, information.outputPath('control.png'));
            await clickWithBackgroundClubNotice(page, 'menu-button', 3);
            await clickWithBackgroundClubNotice(page, 'drawer-menu-item-exit', 3);
            await expect(page.getByTestId('run-game-view')).toBeHidden();
            await expect(page.getByTestId(`private-room-${roomId}`).filter({ visible: true })).toBeVisible();
          });
          await expect(page.getByTestId('create-game-button').filter({ visible: true })).toBeVisible();
          check();
          await withTable(page, newAccount, /** 仅对故障房间注入，并通过原入口验证恢复。
           * @param roomId - 故障房间的准确标识。 */ async roomId => {
            const target = `/v10/texas_holdem/room/${roomId}/buy_in/apply`;
            await serverErrors.command('server-errors', { path: target, method: 'POST', status, format, fingerprint });
            for (const attempt of [1, 2]) {
              expect((await submitBuyIn(page, target)).status()).toBe(status);
              await expect.poll(/** 每次页面操作都必须增加一次准确的 5xx 命中。 */ async () => {
                const state = await serverErrors.command<FaultState>('server-errors');
                return state.events.filter(/** 只统计本房间指定状态的注入响应。
                 * @param event - 脱敏 HTTP 事件。 */ event => event.path === target
                  && event.source === 'injected-5xx' && event.status === status).length;
              }).toBe(attempt);
              await observeError(page, information, status, format, attempt);
            }
            await serverErrors.command('server-errors', { enabled: false });
            expect((await submitBuyIn(page, target)).ok(), '解除后必须收到新的真实成功响应').toBe(true);
            await expectSeated(page);
            await expectUpstream(serverErrors, target);
            await capture(page, information.outputPath('recovered.png'));
          });
        } finally {
          await serverErrors.command('server-errors', { enabled: false });
          const state = await serverErrors.command<FaultState>('server-errors');
          await writeFile(information.outputPath('http-events.json'), JSON.stringify(state, null, 2));
        }
      });
    });
  }
}
