import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { mockDailyBonusWallet } from '../cases/hall/walletPresentation';

test('每日奖励只固定金币展示，真实钱包请求和其他币种保持原值', async ({ context, page }) => {
  const original = { ok: true, result: { id: 'real-wallet', currencies: [
    { code: 'coin', balance: '0' }, { code: 'diamond', balance: '60' },
  ] } };
  let method = '';
  const server = createServer((request, response) => {
    method = request.method || '';
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(original));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动钱包测试服务。');
  try {
    await mockDailyBonusWallet(context);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const displayed = await page.evaluate(async () => {
      const response = await fetch('/v10/wallet/real-wallet', { method: 'PUT' });
      return response.json();
    });
    expect(method).toBe('PUT');
    expect(displayed).toEqual({ ...original, result: { ...original.result, currencies: [
      { code: 'coin', balance: '1000' }, { code: 'diamond', balance: '60' },
    ] } });
    expect(original.result.currencies[0].balance).toBe('0');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('每日奖励不能将真实钱包的 401 或业务错误改成成功', async ({ context, page }) => {
  let status = 401;
  const original = { ok: false, error_type: 'invalid_session' };
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(original));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动钱包测试服务。');
  try {
    await mockDailyBonusWallet(context);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    for (status of [401, 200]) {
      const received = await page.evaluate(async () => {
        const response = await fetch('/v10/wallet/real-wallet', { method: 'PUT' });
        return { status: response.status, body: await response.json() };
      });
      expect(received).toEqual({ status, body: original });
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
