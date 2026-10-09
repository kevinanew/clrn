import { expect, test } from '@playwright/test';
import { clickAfterSignInNotices } from './cases/_shared/sign-in-notices';

test('新账号救济金提示取消后才点击俱乐部，不领取资产', async ({ page }) => {
  await page.setContent(`
    <button data-testid="club-tab">俱乐部</button>
    <div role="dialog" style="position:fixed;inset:0;background:white">
      <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
      <button data-testid="alert-custom-button">取消</button>
      <button data-testid="alert-custom-button">确认</button>
    </div>
    <p id="result"></p>
  `);
  await page.evaluate(() => {
    const result = document.getElementById('result')!;
    document.querySelector('[data-testid="club-tab"]')!.addEventListener('click', () => {
      result.textContent = '进入俱乐部';
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', () => {
      document.querySelector('[role="dialog"]')!.remove();
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', () => {
      result.textContent = '领取资产';
    });
  });
  await clickAfterSignInNotices(page, 'club-tab');
  await expect(page.locator('#result')).toHaveText('进入俱乐部');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('未知登录错误保留提示并使操作失败，不强行穿过弹窗', async ({ page }) => {
  await page.setContent(`
    <button data-testid="club-tab">俱乐部</button>
    <div role="dialog" style="position:fixed;inset:0;background:white">
      <p data-testid="alert-message-text">账号登录失败</p>
      <button data-testid="alert-custom-button">确认</button>
    </div>
  `);
  await expect(clickAfterSignInNotices(page, 'club-tab')).rejects.toThrow();
  await expect(page.getByTestId('alert-message-text')).toHaveText('账号登录失败');
  await expect(page.getByRole('dialog')).toBeVisible();
});
