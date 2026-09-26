import { expect, test, type Page } from '@playwright/test';
import { unique } from './page';

/** 大厅后台俱乐部列表请求可能弹错；仅在点击受阻时确认该已知提示一次。 */
export async function clickWithBackgroundClubNotice(page: Page, testId: string): Promise<void> {
  const back = await unique(page, testId);
  try {
    await back.click({ trial: true, timeout: 3_000 });
  } catch (error) {
    const message = page.getByTestId('alert-message-text').filter({ visible: true });
    if (!(await message.count())) throw error;
    // 其他接口错误、业务提示、多个弹窗均保留为失败，不自动关闭。
    await expect(message).toHaveCount(1);
    await expect(message).toHaveText(/^\d+\s+v10\/club\?user_id=[\w-]+\s+网络有点问题，请重试$/);
    const confirm = await unique(page, 'alert-custom-button');
    await expect(confirm).toHaveText('好的');
    test.info().annotations.push({
      type: 'staging-background-error',
      description: '后台 v10/club 列表请求出现网络错误；用户点击“好的”一次后继续当前操作。',
    });
    await confirm.click();
    await expect(message).not.toBeVisible();
  }
  // 真实点击仅执行一次；不因业务请求慢而重复提交。
  await (await unique(page, testId)).click();
}

export async function goBack(page: Page): Promise<void> {
  await clickWithBackgroundClubNotice(page, 'navigation-bar-back-image');
}
