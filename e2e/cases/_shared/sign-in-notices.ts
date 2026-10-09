import { expect, test, type Page } from '@playwright/test';
import { unique } from './page';

const reliefNotice = /^(?:3000个免费的金币，请收下|3000 free coins, please accept them)$/;
const clubNotice = /^\d+\s+v10\/club\?user_id=[\w-]+\s+网络有点问题，请重试$/;

/**
 * 在后续操作前处理延迟出现的登录提示，每种提示每页最多处理一次。
 * 救济金只能取消，未知提示保留并使操作失败，避免掩盖业务错误。
 * @param page - 安装提示处理器的 Playwright 页面。
 */
export async function installSignInNoticeHandler(page: Page): Promise<void> {
  const message = page.getByTestId('alert-message-text').filter({ visible: true });
  const privacy = page.getByTestId('privacy-popup-title').filter({ visible: true });
  let handledRelief = false;
  let handledClubNotice = false;
  let handledPrivacy = false;
  // 只订阅已知提示，让专门验证业务错误的案例仍可自行检查、关闭其他 alert。
  const knownNotice = message.filter({ hasText: reliefNotice })
    .or(message.filter({ hasText: clubNotice })).or(privacy).first();
  await page.addLocatorHandler(knownNotice, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      // 两个弹窗可能叠在一起；先试探隐私同意按钮是否处于最上层。
      if (!handledPrivacy && await privacy.count()) {
        const agree = page.getByTestId('privacy-popup-agree').filter({ visible: true });
        const onTop = await agree.click({ trial: true, timeout: 1_000 })
          .then(() => true).catch(() => false);
        if (onTop) {
          await expect(privacy).toHaveCount(1);
          await expect(privacy).toHaveText('用户隐私策略概要');
          await expect(await unique(page, 'privacy-popup-content')).toContainText('隐私政策');
          await agree.click();
          await expect(privacy).not.toBeVisible();
          handledPrivacy = true;
          continue;
        }
      }
      if (!await message.count()) return;
      await expect(message).toHaveCount(1);
      const content = (await message.textContent())?.trim() || '';
      if (!handledRelief && reliefNotice.test(content)) {
        const cancel = page.getByTestId('alert-custom-button').filter({ visible: true })
          .filter({ hasText: /^(?:取消|Cancel)$/ });
        await expect(cancel).toHaveCount(1);
        await cancel.click();
        handledRelief = true;
        // alert 会复用节点显示下一个提示，只等待当前救济金内容消失。
        await expect(message.filter({ hasText: reliefNotice })).not.toBeVisible();
      } else if (!handledClubNotice && clubNotice.test(content)) {
        const confirm = await unique(page, 'alert-custom-button');
        await expect(confirm).toHaveText('好的');
        await confirm.click();
        handledClubNotice = true;
        await expect(message.filter({ hasText: clubNotice })).not.toBeVisible();
        test.info().annotations.push({
          type: 'staging-background-error',
          description: '登录后后台俱乐部请求出错，用户确认一次后继续。',
        });
      } else {
        // 保留未知或重复提示，让原操作因弹窗未消失而失败。
        return;
      }
    }
  });
}

/**
 * 用真实按钮处理登录后的已知提示，其他弹层仍会使测试失败。
 * @param page - 执行操作的 Playwright 页面。
 * @param testId - 目标元素的测试标记。
 */
export async function clickAfterSignInNotices(page: Page, testId: string): Promise<void> {
  let handledClubNotice = false;
  let handledPrivacy = false;
  let handledRelief = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const target = await unique(page, testId);
    try {
      // 先检查可操作性，避免点击已经生效后重试业务操作。
      await target.click({ trial: true, timeout: 3_000 });
      break;
    } catch (error) {
      const privacy = page.getByTestId('privacy-popup-title').filter({ visible: true });
      if (!handledPrivacy && await privacy.count()) {
        await expect(privacy).toHaveCount(1);
        await expect(privacy).toHaveText('用户隐私策略概要');
        await expect(await unique(page, 'privacy-popup-content')).toContainText('隐私政策');
        const agree = await unique(page, 'privacy-popup-agree');
        const privacyOnTop = await agree.click({ trial: true, timeout: 1_000 })
          .then(() => true).catch(() => false);
        if (privacyOnTop) {
          await agree.click();
          await expect(privacy).not.toBeVisible();
          handledPrivacy = true;
          continue;
        }
      }
      const message = page.getByTestId('alert-message-text').filter({ visible: true });
      if (await message.count()) {
        await expect(message).toHaveCount(1);
        const content = (await message.textContent())?.trim() || '';
        if (!handledClubNotice && clubNotice.test(content)) {
          const confirm = await unique(page, 'alert-custom-button');
          await expect(confirm).toHaveText('好的');
          await confirm.click();
          await expect(message.filter({ hasText: clubNotice })).not.toBeVisible();
          handledClubNotice = true;
          test.info().annotations.push({ type: 'staging-background-error', description: '登录后后台俱乐部请求出错，用户确认一次后继续。' });
          continue;
        }
        if (!handledRelief && reliefNotice.test(content)) {
          // 低余额账号登录后可能提示领取救济金；取消以保持测试资产不变。
          const cancel = page.getByTestId('alert-custom-button').filter({ visible: true })
            .filter({ hasText: /^(?:取消|Cancel)$/ });
          await expect(cancel).toHaveCount(1);
          await cancel.click();
          await expect(message.filter({ hasText: reliefNotice })).not.toBeVisible();
          handledRelief = true;
          continue;
        }
        throw error;
      }
      throw error;
    }
  }
  await (await unique(page, testId)).click();
}
