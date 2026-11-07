/** 在旧 master 真实页面复现入座错误弹窗，以正确提示断言保留修复前失败。 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import type { Mitmproxy } from '../../helpers/mitmproxy-client';
import { clickWithBackgroundClubNotice } from '../../cases/_shared/navigation';
import { test, expect } from './fixtures';
import { withTable } from './table';
import { expectSeated, submitBuyIn, withNoPageErrors } from './buy-in';
import { capture } from './capture';

type RpcObservation = { source: string; path: string; status: number | null; ok: boolean | null;
  commandId: number; seat: number; gatewayVersion: string };
type RpcState = { events: RpcObservation[] };

/**
 * 只统计本例入座 RPC 的真实网关 5xx。
 * @param proxy - 本轮独占代理。
 * @param target - 本轮确切入座路径。
 */
async function failures(proxy: Mitmproxy, target: string): Promise<RpcObservation[]> {
  const state = await proxy.command<RpcState>('server-errors');
  return state.events.filter(/** 排除正常对照与其他房间。
   * @param event - 脱敏入座事件。 */ event => event.source === 'gateway-5xx' && event.path === target);
}

/**
 * 正常对照和故障恢复都必须收到同一入座方法的真实成功回复。
 * @param proxy - 本轮专用代理。
 * @param target - 准确入座路径。
 * @param after - 只接受该事件位置之后的回复。
 */
async function expectUpstreamSit(proxy: Mitmproxy, target: string, after = 0): Promise<void> {
  await expect.poll(/** 只接受透传 staging 的当前房间成功回复。 */ async () => {
    const state = await proxy.command<RpcState>('server-errors');
    return state.events.slice(after).some(/** 旧版缺失的 HTTP 状态不作猜测。
     * @param event - 脱敏 RPC 事件。 */ event => event.source === 'upstream-rpc'
      && event.path === target && event.ok === true);
  }).toBe(true);
}

/**
 * 先保存真实弹窗，再检查修复后应出现的通用提示；不把修复前的失败改成通过。
 * @param page - 真实旧版或修复版页面。
 * @param information - 本轮截图和文字证据。
 * @param attempt - 首次失败或主动重试。
 */
async function observeDialog(page: Page, information: TestInfo, attempt: number): Promise<void> {
  const dialog = page.getByTestId('common-alert-container');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('common-alert-button-cancel')).toBeVisible();
  await expect(page.getByTestId('common-alert-button-retry')).toBeVisible();
  const message = await page.getByTestId('common-alert-message').textContent();
  await writeFile(information.outputPath(`sit-error-${attempt}.json`), JSON.stringify({
    message, originalDialogReproduced: true, originalHistoricalMessageReproduced: /玩家筹码不足-sit/.test(message || ''),
    scope: '真实旧版页面和原版网关的入座 5xx；不宣称还原历史筹码不足原因',
  }, null, 2));
  await capture(page, information.outputPath(`sit-error-${attempt}.png`));
  expect.soft(message, '5xx 应显示统一网络提示，不能直接暴露后端原文和 sit 后缀')
    .toBe('网络有点问题，请重试');
}

/**
 * 验证故障解除后的真实入座回复及原有筹码，不以注入的成功消息代替。
 * @param page - 仍显示重试弹窗的页面。
 * @param proxy - 已解除故障的代理。
 * @param roomId - 准确故障房间。
 */
async function recover(page: Page, proxy: Mitmproxy, roomId: string): Promise<void> {
  const target = `/v10/texas_holdem/room/${roomId}/sit`;
  const before = (await proxy.command<RpcState>('server-errors')).events.length;
  await proxy.command('server-errors', { enabled: false });
  await page.getByTestId('common-alert-button-retry').click();
  await expectUpstreamSit(proxy, target, before);
  await expectSeated(page);
}

for (const status of [500, 503]) {
  for (const format of ['json', 'html']) {
    test(`入座 5xx ${status} ${format}：旧版弹窗与同座位主动重试`, /**
     * 正常对照通过后，实际点击座位并让入座 API 返回 5xx。
     * @param fixtures - 正常登录的页面、账号和专用网关代理。
     * @param information - 本轮取证输出。 */ async ({ page, newAccount, serverErrors }, information) => {
      const fingerprint = createHash('sha256')
        .update(newAccount.authorization.replace(/^bearer\s+/i, '')).digest('hex');
      await withNoPageErrors(page, /** 对照异常阻止后续故障实验。
       * @param check - 正常对照的页面异常检查。 */ async check => {
        try {
          await withTable(page, newAccount, /** 真实入座对照，不模拟正常响应。
           * @param roomId - 对照房间。 */ async roomId => {
            const target = `/v10/texas_holdem/room/${roomId}/sit`;
            await serverErrors.command('server-errors', { path: target, method: 'PUT', status, format,
              userId: newAccount.userId, fingerprint, enabled: false });
            expect((await submitBuyIn(page, `/v10/texas_holdem/room/${roomId}/buy_in/apply`)).ok()).toBe(true);
            await expectSeated(page);
            await expectUpstreamSit(serverErrors, target);
            await capture(page, information.outputPath('control.png'));
            await expect(page.getByTestId('deposit-buyin-message-touchable')).not.toBeInViewport({ timeout: 30_000 });
            await clickWithBackgroundClubNotice(page, 'menu-button', 3);
            await clickWithBackgroundClubNotice(page, 'drawer-menu-item-stand_up', 3);
            await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeHidden();
            check();
            await serverErrors.command('server-errors', { path: target, method: 'PUT', status, format,
              userId: newAccount.userId, fingerprint });
            await page.getByTestId('in-game-container-seat').first().click();
            await expect.poll(/** 必须实际通过原版网关收到首次 5xx。 */ async () =>
              (await failures(serverErrors, target)).length).toBe(1);
            await observeDialog(page, information, 1);
            await page.getByTestId('common-alert-button-cancel').click();
            await expect(page.getByTestId('common-alert-container')).toHaveCount(0);
            expect((await failures(serverErrors, target)).length, '取消不应自动重发入座').toBe(1);
            await page.getByTestId('in-game-container-seat').first().click();
            await expect.poll(/** 用户重新选座才产生新命令。 */ async () =>
              (await failures(serverErrors, target)).length).toBe(2);
            await page.getByTestId('common-alert-button-retry').click();
            await expect.poll(/** 错误框中的主动重试必须再次到达原版网关。 */ async () =>
              (await failures(serverErrors, target)).length).toBe(3);
            await observeDialog(page, information, 2);
            const events = await failures(serverErrors, target);
            expect(events.map(/** 所有主动请求都保留原座位编号。
             * @param event - 实际 RPC 命令记录。 */ event => event.seat)).toEqual([events[0].seat, events[0].seat, events[0].seat]);
            expect(events.map(/** 不将应用收到的信封状态冒充真实下游 HTTP 状态。
             * @param event - 实际 HTTP 5xx 记录。 */ event => event.status)).toEqual([status, status, status]);
            await recover(page, serverErrors, roomId);
            await capture(page, information.outputPath('recovered.png'));
          });
        } finally {
          await serverErrors.command('server-errors', { enabled: false });
          const state = await serverErrors.command<RpcState>('server-errors');
          await writeFile(information.outputPath('sit-events.json'), JSON.stringify(state, null, 2));
        }
      });
    });
  }
}
