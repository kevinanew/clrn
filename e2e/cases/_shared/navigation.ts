import { expect, test, type Page } from '@playwright/test';
import { unique } from './page';

/** 只确认已核实的后台提示；创建后多个刷新请求可能依次产生排队提示。 */
export async function clickWithBackgroundClubNotice(page: Page, testId: string, maximumNotices = 1): Promise<void> {
  if (!Number.isInteger(maximumNotices) || maximumNotices < 1 || maximumNotices > 3) {
    throw new Error('已知后台提示的确认上限必须为1～3');
  }
  for (let handled = 0; handled < maximumNotices; handled++) {
    try {
      await (await unique(page, testId)).click({ trial: true, timeout: 3_000 });
      break;
    } catch (error) {
      const message = page.getByTestId('alert-message-text').filter({ visible: true });
      if (!(await message.count())) throw error;
      // 其他接口错误、业务提示、同时出现多个弹窗均保持失败。
      await expect(message).toHaveCount(1);
      await expect(message).toHaveText(/^\d+\s+v10\/club\?user_id=[\w-]+\s+网络有点问题，请重试$/);
      const confirm = await unique(page, 'alert-custom-button');
      await expect(confirm).toHaveText('好的');
      test.info().annotations.push({
        type: 'staging-background-error',
        description: `后台 v10/club 请求出现网络提示；用户确认第${handled + 1}条后继续当前操作。`,
      });
      await confirm.click();
    }
  }
  // 真实点击仅执行一次；不因业务请求慢而重复提交。
  await (await unique(page, testId)).click({ trial: true });
  await (await unique(page, testId)).click();
}

export async function goBack(page: Page): Promise<void> {
  await clickWithBackgroundClubNotice(page, 'navigation-bar-back-image');
}
