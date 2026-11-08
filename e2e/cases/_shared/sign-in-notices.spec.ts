import assert from 'node:assert/strict';
import { test, type Page } from '@playwright/test';
import { installSignInNoticeHandler, clickAfterSignInNotices } from './sign-in-notices';

const relief = '3000个免费的金币，请收下';
const club = '503 v10/club?user_id=synthetic-user 网络有点问题，请重试';
const privacyView = '<div data-testid="privacy-popup-title">用户隐私策略概要</div><div data-testid="privacy-popup-content">隐私政策</div><button data-testid="privacy-popup-agree" data-dismiss>同意</button>';

/**
 * 创建真实本地 DOM，只有已核实的隐私提示拥有专用标题。
 * @param notice - 场景指定提示。
 */
function noticeView(notice: string) {
  if (notice === 'privacy') return privacyView;
  const label = notice === club ? '好的' : '取消';
  return `<div data-testid="alert-message-text">${notice}</div><button data-testid="alert-custom-button" data-dismiss>${label}</button>`;
}

/**
 * 在本机 Chromium 验证真实遮挡、按钮与处理器；不连接部署站点。
 * @param page - 当前隔离页面。
 * @param notices - 按显示顺序排列的提示。
 */
async function noticePage(page: Page, notices: string[]) {
  page.setDefaultTimeout(2_500);
  await page.setContent('<button data-testid="hall-tab" data-target>大厅</button><div id="overlay" style="position:fixed;inset:0;background:white;z-index:99"></div>');
  await page.evaluate(/** 按队列展示提示，并记录真实目标点击次数。
   * @param views - 测试提示标记。 */ views => {
    const overlay = document.getElementById('overlay')!;
    let index = 0;
    const actions = {
      /** 更新下一层弹窗，保持同一 alert 节点容器。 */
      advance() {
        const view = views[index++];
        overlay.innerHTML = view || '';
        overlay.style.display = view ? 'block' : 'none';
      },
      /** 记录目标按钮实际点击，trial 不能产生此事件。 */
      recordClick() { document.body.dataset.clicks = String(Number(document.body.dataset.clicks || '0') + 1); },
    };
    document.addEventListener('click', /** 路由真实 DOM 点击。
     * @param event - 浏览器点击事件。 */ event => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-dismiss]')) actions.advance();
      if (target.closest('[data-target]')) actions.recordClick();
    });
    actions.advance();
  }, notices.map(noticeView));
  return page;
}

/**
 * 使用两种公开入口触发一次目标点击。
 * @param page - 本机真实页面。
 * @param mode - 自动处理器或显式提示处理。
 */
async function clickTarget(page: Page, mode: string) {
  if (mode === 'explicit') return clickAfterSignInNotices(page, 'hall-tab');
  await installSignInNoticeHandler(page);
  await page.getByTestId('hall-tab').click();
}

for (const mode of ['handler', 'explicit']) {
  test(`${mode} 保留隐私、救济金和俱乐部提示顺序，实际业务只点一次`, /** 验证叠层提示与真实按钮事件。
   * @param fixtures - 本例隔离页面。 */ async ({ page }) => {
    const annotations = test.info().annotations;
    await noticePage(page, ['privacy', relief, club]);
    await clickTarget(page, mode);
    assert.equal(await page.locator('body').getAttribute('data-clicks'), '1');
    assert.equal(annotations.length, 1);
    assert.equal(await page.getByTestId('alert-message-text').count(), 0);
  });
  for (const notices of [[relief, 'privacy', relief], ['未知业务错误']]) {
    test(`${mode} 未知或重复提示仍阻断：${notices.join(' → ')}`, /** 验证未知业务错误不能被吞掉。
     * @param fixtures - 本例隔离页面。 */ async ({ page }) => {
      await noticePage(page, notices);
      await assert.rejects(clickTarget(page, mode));
      assert.equal(await page.locator('body').getAttribute('data-clicks'), null);
      assert.equal(await page.getByTestId('alert-message-text').textContent(), notices.at(-1));
    });
  }
}
