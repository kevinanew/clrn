import type { BrowserContext } from '@playwright/test';

/**
 * 每日奖励截图使用固定金币展示余额，避免账号池切换改变救济金按钮状态。
 * 先请求真实钱包；只修改成功响应里的金币展示值，保留钻石、身份和错误响应。
 * 此路由仅用于每日奖励视觉场景，不向服务器设置余额或领取救济金。
 * @param context - 当前每日奖励场景的独立浏览器上下文。
 */
export async function mockDailyBonusWallet(context: BrowserContext): Promise<void> {
  await context.route(/\/v10\/wallet\/[^/?]+(?:\?|$)/, async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    if (body?.ok === true) {
      if (!Array.isArray(body.result?.currencies)) throw new Error('每日奖励钱包响应缺少币种清单。');
      for (const currency of body.result.currencies) {
        if (currency.code === 'coin') currency.balance = '1000';
      }
    }
    await route.fulfill({ response, json: body });
  });
}
