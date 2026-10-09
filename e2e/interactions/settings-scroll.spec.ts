import { expect, openApp, test } from './fixtures';
import { scrollToItem } from './gestures';

test('我的虚拟列表可滚动到后续菜单并进入关于页面', /**
 * 验证真实滚动能挂载并点击首屏后的菜单。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
  isMobile,
}) => {
  await openApp(page);
  await page.getByTestId('settings-tab').click();
  const list = page.locator('[data-testid="settings-list"]:visible');
  const about = page.locator('[data-testid="about-laiwan"]:visible');
  await scrollToItem(page, list, about, isMobile);
  await expect
    .poll(/** 读取实际滚动位置。 */ () => list.evaluate(/**
     * 返回纵向偏移。
     * @param el - 当前查询布局或滚动位置的 DOM 元素。
     */ (el) => el.scrollTop))
    .toBeGreaterThan(0);
  await about.click();
  await expect(page.getByTestId('current-server-text')).toBeVisible();
});

test('我的列表最后一项可通过真实滚动进入视口', /**
 * 验证尾部菜单可达，不执行退出登录。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
  isMobile,
}) => {
  await openApp(page);
  await page.getByTestId('settings-tab').click();
  const list = page.locator('[data-testid="settings-list"]:visible');
  const signOut = page.locator('[data-testid="sign-out"]:visible');
  await expect(signOut).not.toBeInViewport();
  await scrollToItem(page, list, signOut, isMobile);
  await expect(signOut).toBeInViewport({ ratio: 1 });
});
