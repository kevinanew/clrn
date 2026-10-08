import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('截图索引支持模块选择、组合搜索和空结果恢复', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../snapshots/index.html')).href);
  const sections = page.locator('.module-section:visible');
  await expect(sections).toHaveCount(9);

  await page.getByRole('button', { name: /^德州牌桌/ }).click();
  await expect(sections).toHaveCount(1);
  await expect(sections).toHaveAttribute('data-group', 'texas-holdem');

  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile chat');
  const cards = page.locator('article:visible');
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('显示 1 张 · 1 个模块');

  await page.getByRole('searchbox', { name: '搜索截图' }).fill('不存在的截图');
  await expect(cards).toHaveCount(0);
  await expect(page.getByText('没有匹配的截图，请调整模块或搜索词。')).toBeVisible();

  await page.getByRole('searchbox', { name: '搜索截图' }).fill('');
  const allModules = page.getByRole('button', { name: /^全部模块/ });
  await allModules.focus();
  await page.keyboard.press('Enter');
  await expect(sections).toHaveCount(9);
  await expect(allModules).toHaveAttribute('aria-pressed', 'true');
});
