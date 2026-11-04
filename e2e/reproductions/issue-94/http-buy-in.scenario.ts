/** 在正常入桌后对真实 HTTP 带入接口注入故障，与 WebSocket 入座分层取证。 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { withPrivateTable } from './private-table';
import type { Page } from '@playwright/test';
import { screenshotAfterSettling } from './screenshot';

type HttpEvent = { direction: string; mode?: string; layer: string; status?: number; ok?: boolean };
type FaultStatus = { mode: string; timeline: HttpEvent[] };

/**
 * 从可见座位重新打开带入弹窗并确认，保留真实业务请求。
 * @param page - 当前真实牌桌页面。
 */
async function submitBuyInFromSeat(page: Page): Promise<void> {
  if (await page.getByTestId('common-alert-button-undefined').isVisible()) {
    await page.getByTestId('common-alert-button-undefined').click();
  }
  await page.getByTestId('in-game-container-seat').first().click();
  await expect(page.getByTestId('buy-in-confirm-button')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('buy-in-confirm-button').click();
}

for (const mode of ['http-503', 'http-504', 'timeout', 'disconnect', 'invalid-json', 'missing-fields', 'business-conflict']) {
  test(`私人桌 HTTP 带入 ${mode} 应正确提示并可恢复`, async ({ tablePage: page, newAccount, faultProxy }, information) => {
    await withPrivateTable(page, newAccount, async roomId => {
      await page.getByTestId('in-game-container-seat').first().click();
      await expect(page.getByTestId('buy-in-confirm-button')).toBeVisible({ timeout: 30_000 });
      const scope = { roomId, operation: 'buy-in', fingerprint: createHash('sha256')
        .update(newAccount.authorization.replace(/^bearer\s+/i, '')).digest('hex') };
      await faultProxy.command('texas', { ...scope, mode });
      try {
        await page.getByTestId('buy-in-confirm-button').click();
        await expect.poll(async () => {
          const status = await faultProxy.command<FaultStatus>('texas');
          return status.timeline.filter(event => event.direction === 'request' && event.mode === mode).length;
        }, { message: 'HTTP 故障必须命中本例真实带入请求', timeout: 30_000 }).toBeGreaterThan(0);
        const notice = page.getByTestId('toastText1')
          .or(page.getByTestId('common-alert-message')).or(page.getByTestId('alert-message-text')).filter({ visible: true }).first();
        await expect.soft(notice, '请求失败后应有可读提示').toBeVisible({ timeout: 40_000 });
        if (await notice.isVisible()) {
          expect.soft(await notice.textContent()).not.toMatch(/undefined|筹码不足|余额不足/);
        }
        await screenshotAfterSettling(page, information.outputPath('01-http-fault.png'), { buyIn: 'closed' });
        await expect(page.getByTestId('texas-holdem-self-seated-marker')).not.toBeVisible();
        const first = await faultProxy.command<FaultStatus>('texas');
        const hits = first.timeline.filter(event => event.direction === 'request' && event.mode === mode).length;
        await submitBuyInFromSeat(page);
        await expect.poll(async () => {
          const status = await faultProxy.command<FaultStatus>('texas');
          return status.timeline.filter(event => event.direction === 'request' && event.mode === mode).length;
        }, { message: 'HTTP 故障期间再次操作必须再次命中', timeout: 30_000 }).toBeGreaterThan(hits);
        await expect(page.getByTestId('buy-in-confirm-button')).not.toBeVisible({ timeout: 40_000 });
        await faultProxy.command('texas', { ...scope, mode: 'none' });
        await submitBuyInFromSeat(page);
        await expect.poll(async () => {
          const status = await faultProxy.command<FaultStatus>('texas');
          return status.timeline.filter(event => event.direction === 'upstream-response' && event.ok).length;
        }, { message: '解除 HTTP 故障后必须再次请求真实上游并成功', timeout: 30_000 }).toBeGreaterThan(0);
        await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('text-holdem-own-balance-text')).toHaveText('100');
        await screenshotAfterSettling(page, information.outputPath('02-http-recovered.png'),
          { buyIn: 'closed', commonAlert: 'closed' });
      } finally {
        await faultProxy.command('texas', { ...scope, mode: 'none' });
        const status = await faultProxy.command<FaultStatus>('texas');
        const output = information.outputPath('scoped-http-timeline.json');
        await writeFile(output, JSON.stringify(status, null, 2));
        await information.attach('scoped-http-timeline', { path: output, contentType: 'application/json' });
      }
    });
  });
}
