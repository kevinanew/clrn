import { expect, test } from '../../helpers/diagnostic-test';
import { accountStatus, signIn } from '../_shared/auth';
import { openHall, prepareContext } from '../_shared/page';

// 真实账号登录不生成截图或网络 trace，报告只记录状态码。
test.use({ screenshot: 'off', trace: 'off' });

test('AUTH-002：不同设备再次登录后旧会话失效', /** 验证AUTH-002：不同设备再次登录后旧会话失效。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。
 * @param testInfo - 当前操作使用的 testInfo。 */ async ({ page, context, browser, baseURL, locale }, testInfo) => {
  await test.step('设备 A 登录并验证账户接口有效', /** 执行设备 A 登录并验证账户接口有效。 */ async () => {
    await prepareContext(context);
    await openHall(page);
  });
  const first = await signIn(page);
  expect(await accountStatus(page, first), '第二次登录前 A 应有效').toBe(200);
  const secondContext = await browser.newContext({ baseURL, locale });
  try {
    await prepareContext(secondContext);
    const secondPage = await secondContext.newPage();
    await test.step('不同设备 B 使用同一账号登录', /** 执行不同设备 B 使用同一账号登录。 */ async () => {
      await openHall(secondPage);
    });
    const second = await signIn(secondPage);
    await test.step('新会话有效，旧会话被服务器拒绝', /** 执行新会话有效，旧会话被服务器拒绝。 */ async () => {
      // 代理节点由每个浏览器独立选址，使用用户 ID 验证同一账号。
      expect(second.userId).toBe(first.userId);
      expect(await accountStatus(secondPage, second), 'B 应有效').toBe(200);
      await expect.poll(/** 轮询首个会话状态，验证其他设备登录后的会话替换行为。 */ () => accountStatus(page, first), { timeout: 10_000 }).toBe(401);
      expect(await accountStatus(secondPage, second), '拒绝旧会话后 B 仍有效').toBe(200);
      await testInfo.attach('会话检查结果', {
        body: JSON.stringify({ beforeSecondLogin: 200, oldSession: 401, newSession: 200 }),
        contentType: 'application/json',
      });
    });
  } finally {
    await secondContext.close();
  }
});
