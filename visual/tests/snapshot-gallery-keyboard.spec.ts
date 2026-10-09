import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const galleryUrl = pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href;

test('每个大图操作直接标注快捷键，选择框和焦点变化不会使快捷键失效', async ({ page }) => {
  await page.goto(galleryUrl);
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('pre_game');
  await page.locator('.snapshot-link').first().click();
  const dialog = page.getByRole('dialog');
  const image = dialog.locator('#viewer-image');
  const zoom = dialog.locator('#viewer-zoom');
  await expect(image).toBeVisible();
  for (const id of ['prev', 'next', 'out', 'in', 'fit', 'actual', 'width', 'close', 'original', 'download']) {
    await expect(dialog.locator(`#viewer-${id} kbd`)).toBeVisible();
  }

  await dialog.locator('#viewer-locale').focus();
  await page.keyboard.press('1');
  await expect(zoom).toHaveText('100%');
  await page.keyboard.press('+');
  await expect(zoom).toHaveText('125%');
  await page.keyboard.press('-');
  await expect(zoom).toHaveText('100%');
  await page.keyboard.press('0');
  await expect(dialog.locator('#viewer-fit')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('2');
  await expect(dialog.locator('#viewer-width')).toHaveAttribute('aria-pressed', 'true');
  const before = await image.getAttribute('style');
  await page.keyboard.press('ArrowDown');
  await expect(image).not.toHaveAttribute('style', before!);
  await page.keyboard.press('Home');
  await expect(image).toHaveAttribute('style', before!);
  await page.keyboard.press('End');
  await expect(image).not.toHaveAttribute('style', before!);

  const originalTitle = await dialog.locator('#viewer-title').getAttribute('title');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('#viewer-position')).toContainText('2 /');
  await expect(image).toBeVisible();
  await expect(dialog.locator('#viewer-width')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('#viewer-title')).toHaveAttribute('title', originalTitle!);
  await expect(image).toBeVisible();

  const originalLocale = await dialog.locator('#viewer-locale').inputValue();
  await page.keyboard.press('l');
  await expect(dialog.locator('#viewer-locale')).not.toHaveValue(originalLocale);
  await expect(dialog.locator('#viewer-stage')).toBeFocused();
  await expect(image).toBeVisible();
  await page.keyboard.press('Shift+L');
  await expect(dialog.locator('#viewer-locale')).toHaveValue(originalLocale);
  await expect(image).toBeVisible();
  const originalViewport = await dialog.locator('#viewer-viewport').inputValue();
  await page.keyboard.press('v');
  await expect(dialog.locator('#viewer-viewport')).not.toHaveValue(originalViewport);
  await expect(image).toBeVisible();
  await page.keyboard.press('Shift+V');
  await expect(dialog.locator('#viewer-viewport')).toHaveValue(originalViewport);
  await expect(image).toBeVisible();

  // 记录原图与下载动作，不在回归用例中打开新窗口或下载实际文件。
  await page.evaluate(() => {
    for (const id of ['original', 'download']) {
      const link = document.querySelector<HTMLAnchorElement>(`#viewer-${id}`)!;
      link.addEventListener('click', event => { event.preventDefault(); link.dataset.triggered = 'true'; });
    }
  });
  await page.keyboard.press('o');
  await expect(dialog.locator('#viewer-original')).toHaveAttribute('data-triggered', 'true');
  await page.keyboard.press('d');
  await expect(dialog.locator('#viewer-download')).toHaveAttribute('data-triggered', 'true');
  await page.keyboard.press('?');
  await expect(dialog.locator('.shortcut-panel')).toBeVisible();
  await page.keyboard.press('?');
  await expect(dialog.locator('.shortcut-panel')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('滚轮上下阅读，Ctrl＋滚轮缩放；切图保留显示方式与缩放', async ({ page }) => {
  await page.goto(galleryUrl);
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile pre_game');
  await page.locator('.snapshot-link').first().click();
  const dialog = page.getByRole('dialog');
  const image = dialog.locator('#viewer-image');
  await expect(image).toBeVisible();
  await page.keyboard.press('2');
  const zoom = await dialog.locator('#viewer-zoom').textContent();
  const style = await image.getAttribute('style');
  await dialog.locator('#viewer-stage').hover();
  await page.mouse.wheel(0, 100);
  await expect(image).not.toHaveAttribute('style', style!);
  await expect(dialog.locator('#viewer-zoom')).toHaveText(zoom!);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(dialog.locator('#viewer-zoom')).not.toHaveText(zoom!);
  const zoomAfter = await dialog.locator('#viewer-zoom').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(image).toBeVisible();
  await expect(dialog.locator('#viewer-zoom')).toHaveText(zoomAfter!);
  await page.keyboard.press('Escape');
});

test('列表可纯键盘搜索、选图、切版本、看详情、打开大图并继续浏览', async ({ page }) => {
  await page.goto(galleryUrl);
  const selected = page.locator('.snapshot-link[aria-current="true"]');
  await expect(page.locator('.snapshot-link[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('g');
  await expect(selected).toBeFocused();
  const firstId = await selected.locator('..').getAttribute('data-id');
  await page.keyboard.press('ArrowRight');
  await expect(selected.locator('..')).not.toHaveAttribute('data-id', firstId!);
  await page.keyboard.press('Home');
  await expect(selected.locator('..')).toHaveAttribute('data-id', firstId!);
  await page.keyboard.press('End');
  await expect(page.locator('.snapshot-link').last()).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('/');
  await expect(page.locator('#filter')).toBeFocused();
  await page.keyboard.type('l v x ? c');
  await expect(page.locator('#locale')).toHaveValue('');
  await expect(page.locator('#device')).toHaveValue('');
  await expect(page.locator('#view-mode')).toHaveValue('pages');
  await expect(page.locator('#gallery-shortcuts')).not.toBeVisible();
  await page.locator('#filter').fill('pre_game_chat');
  await page.keyboard.press('Enter');
  await expect(selected).toBeFocused();
  const version = await selected.locator('..').getAttribute('data-id');
  await page.keyboard.press('w');
  await expect(selected.locator('..')).not.toHaveAttribute('data-id', version!);
  await page.keyboard.press('Shift+W');
  await expect(selected.locator('..')).toHaveAttribute('data-id', version!);
  await page.keyboard.press('t');
  await expect(page.locator('article[data-selected="true"] details')).toHaveAttribute('open', '');
  await page.keyboard.press('t');
  await expect(page.locator('article[data-selected="true"] details')).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#viewer-image')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#viewer-position')).toContainText('2 /');
  const displayed = await page.locator('#viewer-title').getAttribute('title');
  await page.keyboard.press('Escape');
  await expect(selected).toBeFocused();
  await expect(selected.locator('..')).toHaveAttribute('data-label', displayed!);
  await page.keyboard.press('Space');
  await expect(page.locator('#viewer')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('模块、全部筛选、对比、说明和清单均可用快捷键，并支持空结果恢复', async ({ page }) => {
  await page.goto(galleryUrl);
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: /^全部模块/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^大厅/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(']');
  await expect(page.getByRole('button', { name: /^登录与认证/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+M');
  await expect(page.getByRole('button', { name: /^全部模块/ })).toHaveAttribute('aria-pressed', 'true');
  for (const [key, id] of [['l', 'locale'], ['v', 'device'], ['r', 'resolution'], ['a', 'auth'], ['c', 'view-mode'], ['s', 'thumbnail-size']]) {
    const before = await page.locator(`#${id}`).inputValue();
    await page.keyboard.press(key);
    await expect(page.locator(`#${id}`)).not.toHaveValue(before);
    await page.keyboard.press(`Shift+${key.toUpperCase()}`);
    await expect(page.locator(`#${id}`)).toHaveValue(before);
  }
  await page.keyboard.press('b');
  await expect(page.locator('#gallery-about')).toHaveAttribute('open', '');
  await page.keyboard.press('b');
  await expect(page.locator('#gallery-about')).not.toHaveAttribute('open', '');
  await page.keyboard.press('?');
  await expect(page.locator('#gallery-shortcuts')).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭快捷键说明' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '关闭快捷键说明' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#gallery-shortcuts')).not.toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#filter')).toBeFocused();
  await page.locator('#filter').fill('不存在的截图');
  await page.keyboard.press('Escape');
  await expect(page.locator('#empty-reset')).toBeFocused();
  await page.keyboard.press('x');
  await expect(page.locator('#filter')).toHaveValue('');
  await expect(page.locator('.snapshot-link[aria-current="true"]')).toBeFocused();
});
