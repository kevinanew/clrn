import { expect, test, type Page } from '../../helpers/diagnostic-test';
import { unique } from './page';

/**
 * 只确认已核实的后台提示；创建后多个刷新请求可能依次产生排队提示。
 * @param page - 执行操作的 Playwright 页面。
 * @param testId - 目标元素的测试标记。
 * @param maximumNotices - 本次点击最多处理的遮挡通知数量。
 */
export async function clickWithBackgroundClubNotice(page: Page, testId: string, maximumNotices = 1): Promise<void> {
  validateNoticeLimit(maximumNotices);
  await clearBackgroundNotices(page, testId, maximumNotices);
  // 真实点击仅执行一次；不因业务请求慢而重复提交。
  await (await unique(page, testId)).click({ trial: true });
  await (await unique(page, testId)).click();
}

/**
 * 有限次数地处理已知通知，不重复实际业务操作。
 * @param page - 当前页面。
 * @param testId - 目标测试标记。
 * @param maximumNotices - 允许处理的通知数量。
 */
async function clearBackgroundNotices(page: Page, testId: string, maximumNotices: number) {
  for (let handled = 0; handled < maximumNotices; handled++) {
    if (await backgroundTargetReady(page, testId, handled)) break;
  }

}

/**
 * 通过导航栏返回上一页，并处理可能遮挡点击的俱乐部通知。
 * @param page - 执行操作的 Playwright 页面。
 */
export async function goBack(page: Page): Promise<void> {
  await clickWithBackgroundClubNotice(page, 'navigation-bar-back-image');
}

/**
 * 设置列表使用虚拟化；先通过滚动挂载折线下的入口，再检查唯一性。
 * @param page - 执行操作的 Playwright 页面。
 * @param id - 目标控件的测试标记。
 */
export async function openSettingsItem(page: Page, id: string): Promise<void> {
  await (await unique(page, 'settings-list')).hover();
  for (let n = 0; n < 12 && !(await page.getByTestId(id).count()); n++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
  }
  await (await unique(page, id)).click();
}

/**
 * 检查每次操作允许处理的通知数量。
 * @param maximumNotices - 用户指定上限。
 */
function validateNoticeLimit(maximumNotices: number) {
  if (![1, 2, 3].includes(maximumNotices)) throw new Error('已知后台提示的确认上限必须为1～3');
}

/**
 * 校验已知俱乐部提示并确认，未知或缺失提示继续传播原始错误。
 * @param page - 当前页面。
 * @param handled - 此前已处理条数。
 * @param error - 原目标试探错误。
 */
async function confirmBackgroundNotice(page: Page, handled: number, error: unknown) {
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

/**
 * 试探目标，失败时只确认一条已知后台提示。
 * @param page - 当前页面。
 * @param testId - 目标测试标记。
 * @param handled - 已处理条数。
 */
async function backgroundTargetReady(page: Page, testId: string, handled: number) {
  try {
    await (await unique(page, testId)).click({ trial: true, timeout: 3_000 });
    return true;
  } catch (error) {
    await confirmBackgroundNotice(page, handled, error);
    return false;
  }
}
