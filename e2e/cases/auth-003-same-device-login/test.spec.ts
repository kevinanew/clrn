import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { accountStatus, signIn } from '../_shared/auth';
import { openHall, prepareContext } from '../_shared/page';

test.use({ screenshot: 'off', trace: 'off' });

test('AUTH-003：相同设备标识再次登录的认证行为', async ({ page, context, browser, baseURL }) => {
  const deviceId = randomUUID();
  await prepareContext(context, deviceId);
  await openHall(page);
  const first = await signIn(page);
  expect(await accountStatus(page, first)).toBe(200);
  const otherContext = await browser.newContext({ baseURL });
  try {
    await prepareContext(otherContext, deviceId);
    const otherPage = await otherContext.newPage();
    await openHall(otherPage);
    const second = await signIn(otherPage);
    expect(second.accountUrl).toBe(first.accountUrl);
    expect(await accountStatus(otherPage, second)).toBe(200);
    await test.step('相同 deviceId 也不能保留两份有效登录凭据', async () => {
      await expect.poll(() => accountStatus(page, first), { timeout: 10_000 }).toBe(401);
      expect(await accountStatus(otherPage, second)).toBe(200);
    });
  } finally {
    await otherContext.close();
  }
});
