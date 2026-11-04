/** 私人记分牌桌只验证客户端错误处理，不冒充金币自动补码的完整复现。 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { withPrivateTable } from './private-table';
import type { Page } from '@playwright/test';

type RpcEvent = { direction: string; commandId?: number; mode?: string; ok?: boolean };
type FaultStatus = { mode: string; timeline: RpcEvent[] };

/**
 * 从实际可见入口再次入座；断连后若已重新显示带入提示，先正常关闭再点座位。
 * @param page - 当前牌桌页面。
 */
async function retrySit(page: Page): Promise<void> {
  const retry = page.getByTestId('common-alert-button-retry');
  if (await retry.isVisible()) {
    await retry.click();
    return;
  }
  const close = page.getByTestId('buy-in-close-button');
  if (await close.isVisible()) await close.click();
  await page.getByTestId('in-game-container-seat').first().click();
}

test('私人桌无故障正常带入及入座对照', async ({ tablePage: page, newAccount }, information) => {
  await withPrivateTable(page, newAccount, async () => {
    await page.screenshot({ path: information.outputPath('01-private-table.png') });
    await page.getByTestId('in-game-container-seat').first().click();
    await expect(page.getByTestId('buy-in-confirm-button')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: information.outputPath('02-buy-in.png') });
    await page.getByTestId('buy-in-confirm-button').click();
    await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('text-holdem-own-balance-text')).toHaveText('100');
    await page.screenshot({ path: information.outputPath('03-seated.png') });
  });
});

for (const mode of ['missing-fields', 'business-conflict', 'timeout', 'disconnect', 'invalid-json']) {
  test(`私人桌入座 ${mode} 应正确提示，解除故障后真实重试`, async ({ tablePage: page, newAccount, faultProxy }, information) => {
    await withPrivateTable(page, newAccount, async roomId => {
      const scope = { roomId, fingerprint: createHash('sha256')
        .update(newAccount.authorization.replace(/^bearer\s+/i, '')).digest('hex') };
      await faultProxy.command('texas', { ...scope, mode });
      try {
        await page.getByTestId('in-game-container-seat').first().click();
        await expect.poll(async () => {
          const status = await faultProxy.command<FaultStatus>('texas');
          return status.timeline.filter(event => event.direction === 'request' && event.mode === mode).length;
        }, { message: '故障必须命中本轮准确房间和账号的真实请求', timeout: 30_000 }).toBeGreaterThan(0);
        const message = page.getByTestId('common-alert-message').filter({ visible: true });
        await expect.soft(message, '入座失败应显示可读错误').toBeVisible({ timeout: 40_000 });
        await page.screenshot({ path: information.outputPath('04-fault.png') });
        if (await message.isVisible()) {
          expect.soft(await message.textContent(), '缺失字段须有可读提示').not.toContain('undefined');
          expect.soft(await message.textContent(), '非余额故障不得误报筹码不足').not.toMatch(/筹码不足|余额不足/);
        }
        const first = await faultProxy.command<FaultStatus>('texas');
        const hits = first.timeline.filter(event => event.direction === 'request' && event.mode === mode).length;
        await retrySit(page);
        await expect.poll(async () => {
          const status = await faultProxy.command<FaultStatus>('texas');
          return status.timeline.filter(event => event.direction === 'request' && event.mode === mode).length;
        }, { message: '故障期间再次重试必须再次命中', timeout: 30_000 }).toBeGreaterThan(hits);
        await expect.soft(message, '故障期间再次入座仍应提示错误').toBeVisible({ timeout: 40_000 });
        await faultProxy.command('texas', { ...scope, mode: 'none' });
        await retrySit(page);
        await expect.poll(async () => {
          const status = await faultProxy.command<FaultStatus>('texas');
          return status.timeline.filter(event => event.direction === 'upstream-response').length;
        }, { message: '重试必须获得真实上游回复', timeout: 30_000 }).toBeGreaterThan(0);
        await expect(page.getByTestId('buy-in-confirm-button')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('buy-in-confirm-button').click();
        await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('text-holdem-own-balance-text')).toHaveText('100');
        await page.screenshot({ path: information.outputPath('05-recovered.png') });
      } finally {
        await faultProxy.command('texas', { ...scope, mode: 'none' });
        const status = await faultProxy.command<FaultStatus>('texas');
        const output = information.outputPath('scoped-rpc-timeline.json');
        await writeFile(output, JSON.stringify(status, null, 2));
        await information.attach('scoped-rpc-timeline', { path: output, contentType: 'application/json' });
      }
    });
  });
}
