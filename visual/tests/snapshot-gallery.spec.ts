import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import manifest from '../gallery/manifest.json';

const pageKey = (page: (typeof manifest.pages)[number]) => JSON.stringify([page.group, page.page, page.signedIn]);
const pageCount = new Set(manifest.pages.map(pageKey)).size;
const totalSummary = `${pageCount} 个页面 · ${manifest.pages.length} 张截图`;
const summaryFor = (group: string) => {
  const pages = manifest.pages.filter(page => page.group === group);
  return `${new Set(pages.map(pageKey)).size} 个页面 · ${pages.length} 张截图`;
};

test('按页面合并、模块选择、组合搜索和空结果恢复', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
  await expect(page.getByRole('status')).toContainText(totalSummary);
  await expect(page.locator('article')).toHaveCount(pageCount);
  await expect(page.locator('.snapshot-link')).toHaveCount(pageCount);
  await page.getByRole('button', { name: /^我的战绩/ }).click();
  await expect(page.locator('.module-section')).toHaveCount(1);
  await expect(page.locator('.module-section')).toHaveAttribute('data-group', 'game-record');
  await expect(page.getByRole('status')).toContainText(summaryFor('game-record'));

  await page.getByRole('button', { name: /^拼三张牌桌/ }).click();
  await expect(page.locator('.module-section')).toHaveAttribute('data-group', 'zhajinhua');
  await expect(page.getByRole('status')).toContainText(summaryFor('zhajinhua'));
  await page.getByRole('button', { name: /^德州牌桌/ }).click();
  await expect(page.locator('.module-section')).toHaveAttribute('data-group', 'texas-holdem');
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile pre_game chat');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toHaveAttribute('data-label', 'zh-Hans_mobile_signed_in_texas_pre_game_chat');
  await expect(page.getByRole('status')).toHaveText('1 个页面 · 1 张截图');

  await page.getByRole('searchbox', { name: '搜索截图' }).fill('不存在的截图');
  await expect(page.locator('article')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '没有匹配的截图' })).toBeVisible();
  await page.getByRole('button', { name: '清除所有筛选' }).click();
  await expect(page.getByRole('status')).toContainText(totalSummary);
  await expect(page.getByRole('button', { name: /^全部模块/ })).toHaveAttribute('aria-pressed', 'true');
});

test('大图按筛选结果切换，关闭后恢复焦点和列表位置', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
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
  await expect(dialog.locator('h2')).toHaveAttribute('title', await first.locator('img').getAttribute('alt')
    .then(alt => alt!.replace(' 页面截图', '')));
  await expect(dialog.getByRole('button', { name: '上一张', exact: true })).toBeDisabled();
  await expect(dialog.locator('#viewer-position')).toHaveText(`1 / ${total} · 当前浏览结果`);
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('#viewer-position')).toHaveText(`2 / ${total} · 当前浏览结果`);
  await expect(dialog.getByRole('link', { name: '打开原图' })).toHaveAttribute('href',
    (await links.nth(1).getAttribute('href'))!);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('#viewer-position')).toHaveText(`1 / ${total} · 当前浏览结果`);
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
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`大图适应窗口、缩放和拖动（${viewport.width}px）`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
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
    await expect(dialog.locator('#viewer-zoom')).toHaveText('125%');
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
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
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('zh-Hans mobile pre_game');
  const links = page.locator('article:visible .snapshot-link');
  await page.evaluate(() => {
    // 大图与缩略图都使用同一内嵌记录。
    const id = Number(document.querySelector('.snapshot-item')!.getAttribute('data-id'));
    eval('galleryRecords')[id].file = 'missing-snapshot.png';
  });
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
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
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
      await expect(dialog.locator('#viewer-position')).toHaveText(`${current} / ${total} · 当前浏览结果`);
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
  }
  await page.keyboard.press('Escape');
  await links.nth(total - 2).click();
  await dialog.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '下一张', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('#viewer-position')).toHaveText(`${total - 1} / ${total} · 当前浏览结果`);
});


test('独立筛选语言、设备、分辨率和登录状态，模块数字随筛选变化', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
  await page.locator('#locale').selectOption('en');
  await page.locator('#device').selectOption('mobile');
  await page.locator('.more-filters summary').click();
  await page.locator('#resolution').selectOption('375x812');
  await page.locator('#auth').selectOption('guest');
  const items = page.locator('.snapshot-item');
  expect(await items.count()).toBeGreaterThan(0);
  for (const label of await items.evaluateAll(elements => elements.map(el => el.getAttribute('data-label')))) {
    expect(label).toMatch(/^en_mobile_/);
    expect(label).not.toContain('signed_in');
  }
  await expect(page.locator('.card-meta').first()).toContainText('375 × 812 · 游客');
  await page.locator('#resolution').selectOption('1440x900');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.getByRole('button', { name: /^全部模块/ }).locator('.module-total')).toHaveText('0');
  await page.getByRole('button', { name: '清除所有筛选' }).click();
  await expect(page.locator('#locale')).toHaveValue('');
  await expect(page.locator('#device')).toHaveValue('');
  await expect(page.getByRole('status')).toContainText(`${manifest.pages.length} 张截图`);
});

test('同页版本切换、语言对照和设备对照', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('pre_game_chat');
  await page.getByRole('button', { name: /^德州牌桌/ }).click();
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('.snapshot-link')).toHaveCount(1);
  const options = page.locator('.variant-select option');
  await expect(options).toHaveCount(6);
  const englishDesktop = await options.filter({ hasText: 'English · 电脑' }).getAttribute('value');
  await page.locator('.variant-select').selectOption(englishDesktop!);
  await expect(page.locator('.snapshot-item')).toHaveAttribute('data-label', 'en_desktop_signed_in_texas_pre_game_chat');
  await page.locator('.snapshot-link').click();
  await expect(page.locator('#viewer-title')).toHaveAttribute('title', 'en_desktop_signed_in_texas_pre_game_chat');
  await expect(page.locator('#viewer-image')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('#view-mode').selectOption('languages');
  await expect(page.locator('article')).toHaveCount(2);
  for (const card of await page.locator('article').all()) {
    await expect(card.locator('.snapshot-link')).toHaveCount(3);
  }
  await page.locator('#view-mode').selectOption('devices');
  await expect(page.locator('article')).toHaveCount(3);
  for (const card of await page.locator('article').all()) {
    await expect(card.locator('.snapshot-link')).toHaveCount(2);
  }
  await page.locator('#view-mode').selectOption('screenshots');
  await expect(page.locator('article')).toHaveCount(6);
});

test('全部页面连续展示、图片按需加载，刷新保留筛选和浏览方式', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
  await expect(page.locator('article')).toHaveCount(pageCount);
  await expect(page.locator('.pagination')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
  expect(await page.locator('.snapshot-link img').evaluateAll(images =>
    images.every(image => image.getAttribute('loading') === 'lazy'))).toBe(true);
  const labels = await page.locator('article').evaluateAll(cards => cards.map(card => card.getAttribute('data-label')));
  await page.reload();
  expect(await page.locator('article').evaluateAll(cards => cards.map(card => card.getAttribute('data-label')))).toEqual(labels);
  await page.locator('#locale').selectOption('zh-Hant');
  await page.locator('#view-mode').selectOption('devices');
  await page.reload();
  await expect(page.locator('#locale')).toHaveValue('zh-Hant');
  await expect(page.locator('#view-mode')).toHaveValue('devices');
  await expect(page.locator('article')).toHaveCount(pageCount);
});

test('大图连续浏览，并可切换同页的语言和设备版本', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
  const item = page.locator('.snapshot-link').nth(23);
  await item.click();
  await expect(page.locator('#viewer-position')).toHaveText(`24 / ${pageCount} · 当前浏览结果`);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#viewer-position')).toHaveText(`25 / ${pageCount} · 当前浏览结果`);
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox', { name: '搜索截图' }).fill('pre_game_chat');
  await page.getByRole('button', { name: /^德州牌桌/ }).click();
  await page.locator('.snapshot-link').click();
  await page.getByRole('combobox', { name: '大图语言', exact: true }).selectOption('en');
  await expect(page.locator('#viewer-title')).toHaveAttribute('title', 'en_mobile_signed_in_texas_pre_game_chat');
  const desktop = await page.locator('#viewer-viewport option').filter({ hasText: '电脑' }).getAttribute('value');
  await page.getByRole('combobox', { name: '大图设备与分辨率', exact: true }).selectOption(desktop!);
  await expect(page.locator('#viewer-title')).toHaveAttribute('title', 'en_desktop_signed_in_texas_pre_game_chat');
  await expect(page.locator('#viewer-image')).toBeVisible();
  await expect(page.locator('#viewer-meta')).toContainText('English · 电脑 · 1440 × 900');
});

for (const width of [1440, 375]) {
  test(`首屏直接显示截图，说明默认折叠且无横向溢出（${width}px）`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../gallery/index.html')).href);
    await expect(page.locator('.about')).not.toHaveAttribute('open', '');
    const image = page.locator('.snapshot-link img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const box = (await image.boundingBox())!;
    expect(box.y).toBeLessThan(page.viewportSize()!.height / 2);
    expect(box.y + box.height).toBeLessThan(812);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 375) {
      await expect(page.locator('#locale')).not.toBeVisible();
      await page.getByRole('button', { name: '筛选与对照' }).click();
      await expect(page.locator('#locale')).toBeVisible();
      await page.locator('#locale').selectOption('en');
      await page.getByRole('button', { name: '筛选与对照' }).click();
      await expect(page.locator('#locale')).not.toBeVisible();
    }
    await testInfo.attach(`gallery-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
