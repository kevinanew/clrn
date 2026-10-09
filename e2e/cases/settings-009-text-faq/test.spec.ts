import { expect, test } from '../_shared/read-account-fixture';
import { goBack } from '../_shared/navigation';
import { unique } from '../_shared/page';
import { openSettings } from '../_shared/settings-navigation';

test('SETTINGS-009：文字 FAQ 的标题、正文与返回', async ({ page, signedInAccount }) => {
  expect(signedInAccount.userId).toBeTruthy();
  await openSettings(page, 'faq');
  const question = await unique(page, 'faq-item-question-plug_in');
  const title = await question.innerText();
  await test.step('答案标题对应问题，文字正文非空', async () => {
    await question.click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(await unique(page, 'faq-detail-scroll-view')).toBeVisible();
    await expect(page.getByTestId(/^faq-detail-paragraph-/).filter({ visible: true }).first()).toContainText(/\S/);
  });
  await test.step('返回问题列表，原问题保持不变', async () => {
    await goBack(page);
    await expect(await unique(page, 'faq-screen')).toBeVisible();
    await expect(await unique(page, 'faq-item-question-plug_in')).toHaveText(title);
  });
});
