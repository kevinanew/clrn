import { expect, test, type Page } from '@playwright/test';
import { unique } from './page';

/** 用真实按钮处理登录后的已知提示，其他弹层仍会使测试失败。 */
export async function clickAfterSignInNotices(page: Page, testId: string): Promise<void> {
  let handledClubNotice = false;
  let handledPrivacy = false;
  let handledRelief = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const target = await unique(page, testId);
    try {
      // 先检查可操作性，避免点击已经生效后重试业务操作。
      await target.click({ trial: true, timeout: 3_000 });
      break;
    } catch (error) {
      const privacy = page.getByTestId('privacy-popup-title').filter({ visible: true });
      if (!handledPrivacy && await privacy.count()) {
        await expect(privacy).toHaveCount(1);
        await expect(privacy).toHaveText('用户隐私策略概要');
        await expect(await unique(page, 'privacy-popup-content')).toContainText('隐私政策');
        const agree = await unique(page, 'privacy-popup-agree');
        const privacyOnTop = await agree.click({ trial: true, timeout: 1_000 })
          .then(() => true).catch(() => false);
        if (privacyOnTop) {
          await agree.click();
          await expect(privacy).not.toBeVisible();
          handledPrivacy = true;
          continue;
        }
      }
      const message = page.getByTestId('alert-message-text').filter({ visible: true });
      if (await message.count()) {
        await expect(message).toHaveCount(1);
        const content = (await message.textContent())?.trim() || '';
        if (!handledClubNotice && /^\d+\s+v10\/club\?user_id=[\w-]+\s+网络有点问题，请重试$/.test(content)) {
          const confirm = await unique(page, 'alert-custom-button');
          await expect(confirm).toHaveText('好的');
          await confirm.click();
          await expect(message).not.toBeVisible();
          handledClubNotice = true;
          test.info().annotations.push({ type: 'staging-background-error', description: '登录后后台俱乐部请求出错，用户确认一次后继续。' });
          continue;
        }
        if (!handledRelief && /^(?:3000个免费的金币，请收下|3000 free coins, please accept them)$/.test(content)) {
          // 低余额账号登录后可能提示领取救济金；取消以保持测试资产不变。
          const cancel = page.getByTestId('alert-custom-button').filter({ visible: true })
            .filter({ hasText: /^(?:取消|Cancel)$/ });
          await expect(cancel).toHaveCount(1);
          await cancel.click();
          await expect(message).not.toBeVisible();
          handledRelief = true;
          continue;
        }
        throw error;
      }
      throw error;
    }
  }
  await (await unique(page, testId)).click();
}
