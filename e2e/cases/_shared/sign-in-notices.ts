import { expect, test, type Page } from '@playwright/test';
import { unique } from './page';

/** 用真实按钮处理登录后的已知提示，其他弹层仍会使测试失败。 */
export async function clickAfterSignInNotices(page: Page, testId: string): Promise<void> {
  let handledClubNotice = false;
  let handledPrivacy = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await unique(page, testId);
    try {
      // 先检查可操作性，避免点击已经生效后重试业务操作。
      await target.click({ trial: true, timeout: 3_000 });
      break;
    } catch (error) {
      const message = page.getByTestId('alert-message-text').filter({ visible: true });
      if (!handledClubNotice && await message.count()) {
        await expect(message).toHaveCount(1);
        await expect(message).toHaveText(/^\d+\s+v10\/club\?user_id=[\w-]+\s+网络有点问题，请重试$/);
        const confirm = await unique(page, 'alert-custom-button');
        await expect(confirm).toHaveText('好的');
        await confirm.click();
        await expect(message).not.toBeVisible();
        handledClubNotice = true;
        test.info().annotations.push({ type: 'staging-background-error', description: '登录后后台俱乐部请求出错，用户确认一次后继续。' });
        continue;
      }
      const privacy = page.getByTestId('privacy-popup-title').filter({ visible: true });
      if (!handledPrivacy && await privacy.count()) {
        await expect(privacy).toHaveCount(1);
        await expect(privacy).toHaveText('用户隐私策略概要');
        await expect(await unique(page, 'privacy-popup-content')).toContainText('隐私政策');
        await (await unique(page, 'privacy-popup-agree')).click();
        await expect(privacy).not.toBeVisible();
        handledPrivacy = true;
        continue;
      }
      throw error;
    }
  }
  await (await unique(page, testId)).click();
}
