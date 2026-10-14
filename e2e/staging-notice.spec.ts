import { expect, test } from '@playwright/test';
import { environment } from './helpers/environment';
import { confirmStagingNotice } from './helpers/staging-notice';

for (const [language, confirmation] of [['zh-Hans', '确认'], ['zh-Hant', '確認'], ['en', 'CONFIRM']]) {
  test(`测试版入口 ${language} 必须输入正确确认文字后才能进入大厅`, async ({ page, context }) => {
    await context.addInitScript(locale => localStorage.setItem('app.language.code.key', locale), language);
    await page.goto(environment.stagingUrl, { waitUntil: 'domcontentloaded' });
    const dialog = page.getByTestId('staging-dialog');
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    const input = dialog.locator('input[data-testid="staging-confirmation-input"], [data-testid="staging-confirmation-input"] input').first();
    const button = dialog.getByTestId('confirm-button');
    await expect(input).toHaveAttribute('placeholder', confirmation);
    await expect(button).toBeDisabled();
    await expect(page.getByTestId('hall-screen')).toBeHidden();
    await input.fill('incorrect-confirmation');
    await expect(button).toBeDisabled();
    await expect(page.getByTestId('hall-screen')).toBeHidden();
    expect(await confirmStagingNotice(page)).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('hall-screen')).toBeVisible({ timeout: 60_000 });
    expect(await confirmStagingNotice(page)).toBe(false);
  });
}
