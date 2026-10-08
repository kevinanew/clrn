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

  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile pre_game chat');
  const cards = page.locator('article:visible');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('data-label', 'zh-Hans_mobile_signed_in_texas_pre_game_chat');
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

test('大图按筛选结果切换，关闭后恢复焦点和列表位置', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../snapshots/index.html')).href);
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile pre_game');
  const links = page.locator('article:visible .snapshot-link');
  const total = await links.count();
  expect(total).toBeGreaterThan(1);
  const first = links.first();
  const originalUrl = page.url();
  await first.focus();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toBeVisible();
  await expect(dialog.locator('h2')).toHaveText(await first.locator('img').getAttribute('alt')
    .then(alt => alt!.replace(' 页面截图', '')));
  await expect(dialog.getByRole('button', { name: '上一张', exact: true })).toBeDisabled();
  await expect(dialog.locator('#viewer-position')).toHaveText(`1 / ${total} · 当前筛选结果`);
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('#viewer-position')).toHaveText(`2 / ${total} · 当前筛选结果`);
  await expect(dialog.getByRole('link', { name: '打开原图' })).toHaveAttribute('href',
    await links.nth(1).evaluate(link => (link as HTMLAnchorElement).href));
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('#viewer-position')).toHaveText(`1 / ${total} · 当前筛选结果`);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(first).toBeFocused();
  expect(page.url()).toBe(originalUrl);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`大图适应窗口、缩放和拖动（${viewport.width}px）`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../snapshots/index.html')).href);
    await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans_desktop_hall');
    await page.locator('article:visible .snapshot-link').first().click();
    const dialog = page.getByRole('dialog');
    const image = dialog.locator('img');
    const stage = dialog.locator('#viewer-stage');
    await expect(image).toBeVisible();
    await expect(dialog.getByRole('button', { name: '上一张', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '下一张', exact: true })).toBeDisabled();
    const bounds = (await stage.boundingBox())!;
    const fitted = (await image.boundingBox())!;
    expect(fitted.width).toBeLessThanOrEqual(bounds.width);
    expect(fitted.height).toBeLessThanOrEqual(bounds.height);
    expect(fitted.x).toBeGreaterThanOrEqual(bounds.x);
    expect(fitted.y).toBeGreaterThanOrEqual(bounds.y);
    const fitZoom = await dialog.locator('#viewer-zoom').textContent();
    await testInfo.attach(`viewer-${viewport.width}.png`, {
      body: await page.screenshot(), contentType: 'image/png',
    });
    await dialog.getByRole('button', { name: '1:1', exact: true }).click();
    await expect(dialog.locator('#viewer-zoom')).toHaveText('100%');
    await dialog.getByRole('button', { name: '放大', exact: true }).click();
    await expect(dialog.locator('#viewer-zoom')).toHaveText('125%');
    const beforeDrag = (await image.boundingBox())!;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 40, center.y + 40, { steps: 4 });
    await page.mouse.up();
    const afterDrag = (await image.boundingBox())!;
    expect(afterDrag.x).toBeGreaterThan(beforeDrag.x);
    expect(afterDrag.y).toBeGreaterThan(beforeDrag.y);
    await page.mouse.wheel(0, -100);
    await expect(dialog.locator('#viewer-zoom')).not.toHaveText('125%');
    await dialog.getByRole('button', { name: '适应窗口', exact: true }).click();
    await expect(dialog.locator('#viewer-zoom')).toHaveText(fitZoom!);
    await stage.dblclick({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    await expect(dialog.locator('#viewer-zoom')).toHaveText('100%');
    await page.keyboard.press('0');
    await expect(dialog.locator('#viewer-zoom')).toHaveText(fitZoom!);
    await page.setViewportSize({ width: 812, height: 375 });
    await expect.poll(async () => (await image.boundingBox())!.height)
      .toBeLessThanOrEqual((await stage.boundingBox())!.height);
    for (const name of ['关闭', '放大', '适应窗口']) {
      const box = (await dialog.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(812);
      expect(box.y + box.height).toBeLessThanOrEqual(375);
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}

test('图片加载失败可恢复，重新打开重置缩放', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../snapshots/index.html')).href);
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile pre_game');
  const links = page.locator('article:visible .snapshot-link');
  await links.first().evaluate(link => link.setAttribute('href', 'missing-snapshot.png'));
  await links.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('图片加载失败，请尝试打开原图，或切换到其他截图。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '放大', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(dialog.locator('img')).toBeVisible();
  await page.keyboard.press('1');
  await expect(dialog.locator('#viewer-zoom')).toHaveText('100%');
  await page.keyboard.press('+');
  await expect(dialog.locator('#viewer-zoom')).toHaveText('125%');
  await page.keyboard.press('Escape');
  await links.nth(1).click();
  await expect(dialog.locator('img')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '适应窗口', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('#viewer-zoom')).not.toHaveText('125%');
});

test('缩放后连续键盘切图及切到末张时保持弹窗焦点', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../snapshots/index.html')).href);
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile pre_game');
  const links = page.locator('article:visible .snapshot-link');
  const total = await links.count();
  await links.first().click();
  const dialog = page.getByRole('dialog');
  let current = 1;
  for (const name of ['1:1', '适应窗口', '放大', '缩小']) {
    await expect(dialog.locator('img')).toBeVisible();
    await dialog.getByRole('button', { name, exact: true }).click();
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('ArrowRight');
      current++;
      await expect(dialog.locator('#viewer-position')).toHaveText(`${current} / ${total} · 当前筛选结果`);
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
  }
  await page.keyboard.press('Escape');
  await links.nth(total - 2).click();
  await dialog.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '下一张', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('#viewer-position')).toHaveText(`${total - 1} / ${total} · 当前筛选结果`);
});
