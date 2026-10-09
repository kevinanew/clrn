import type { Page } from '@playwright/test';
import { expect, openApp, test } from './fixtures';
import { scrollToItem } from './gestures';

/**
 * 只读取真实 SDK 状态，不替换 SDK 或通过脚本打开、关闭窗口。
 * @param page - 执行交互的 Playwright 页面。
 * @param method - 要查询的 SDK 状态：isLoaded 或 isOpen。
 */
async function widgetState(page: Page, method: 'isLoaded' | 'isOpen'): Promise<boolean> {
  return page.evaluate(
    /**
     * 查询 Freshchat 的加载或展开状态。
     * @param name - 浏览器中调用的 Freshchat 状态方法名。
     */ (name) =>
      Reflect.get(window, 'fcWidget')?.[name]() === true,
    method,
  );
}

test('在线客服打开真实 Freshchat，可输入草稿、关闭并再次打开', /**
 * 验证客服入口到真实第三方聊天界面的完整交互。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
  isMobile,
}) => {
  await openApp(page);
  await page.getByTestId('settings-tab').click();
  const settings = page.locator('[data-testid="settings-list"]:visible');
  const contact = page.locator('[data-testid="contact-us"]:visible');
  await scrollToItem(page, settings, contact, isMobile);
  await contact.click();

  const onlineService = page.getByTestId('online-service-button');
  await expect(onlineService).toBeVisible();
  await expect(page.locator('#Freshchat-js-sdk')).toHaveCount(1);
  await expect
    .poll(
      /** 等待实际 Freshchat 网络资源与窗口初始化完成。 */ () => widgetState(page, 'isLoaded'),
      {
        message: '真实 Freshchat SDK 应完成加载；检查脚本、配置和第三方网络请求',
        timeout: 60_000,
      },
    )
    .toBe(true);
  await expect
    .poll(/** 入口点击前窗口应处于关闭状态。 */ () => widgetState(page, 'isOpen'))
    .toBe(false);

  await onlineService.click();
  await expect
    .poll(/** 点击客服入口后读取真实展开状态。 */ () => widgetState(page, 'isOpen'))
    .toBe(true);
  const iframe = page.locator('#fc_frame iframe');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toBeVisible();
  // SDK 动态导航 iframe，节点可能没有 src 属性；核对实际 frame 的 URL。
  await expect
    .poll(/** 读取真实聊天 frame 的最终地址。 */ () => page.frame({ name: 'fc_widget' })?.url())
    .toMatch(/^https:\/\/[^/]+\.freshchat\.com\//);

  const chat = page.frameLocator('#fc_frame iframe');
  const editor = chat.getByRole('textbox');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  // 仅编辑并清空草稿，不按回车或发送按钮，避免创建客服消息及工单。
  const draft = 'Freshchat E2E 客服输入检查';
  await editor.fill(draft);
  await expect(editor).toHaveText(draft);
  await editor.fill('');
  await expect(editor).toBeEmpty();

  const close = chat.getByRole('button', { name: /^(关闭小部件|Close widget)$/i });
  await close.click();
  await expect
    .poll(/** 关闭按钮应真正收起 SDK 窗口。 */ () => widgetState(page, 'isOpen'))
    .toBe(false);
  await expect(iframe).toBeHidden();
  await expect(onlineService).toBeVisible();

  await onlineService.click();
  await expect
    .poll(/** 同一入口再次点击仍可打开窗口。 */ () => widgetState(page, 'isOpen'))
    .toBe(true);
  await expect(iframe).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(editor).toBeEmpty();
  await expect(page.locator('#Freshchat-js-sdk')).toHaveCount(1);
  await expect(iframe).toHaveCount(1);
  await close.click();
  await expect
    .poll(/** 测试结束前确认窗口已关闭。 */ () => widgetState(page, 'isOpen'))
    .toBe(false);
});
