import { expect, test } from '@playwright/test';
import { clickAfterSignInNotices, installSignInNoticeHandler } from './cases/_shared/sign-in-notices';
import { scroll } from './interactions/gestures';

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
  expect(await page.getByRole('dialog').isVisible()).toBe(true);
});

test.describe('登录提示延迟到原始手势之前出现', () => {
  test.use({ hasTouch: true });
  for (const touch of [false, true]) {
    test(`${touch ? '触摸' : '滚轮'}滚动前取消救济金，不点击列表或领取金币`, async ({ page }) => {
      await page.setContent(`
        <div id="list" style="height:240px;overflow:auto;touch-action:pan-y">
          <div style="height:2000px">可滚动列表</div>
        </div>
        <div id="notice" role="dialog" style="display:none;position:fixed;inset:0;background:white">
          <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
          <button data-testid="alert-custom-button">取消</button>
          <button data-testid="alert-custom-button">确认</button>
        </div>
        <p id="clicks">0</p><p id="claimed">0</p>
      `);
      await page.evaluate(() => {
        document.getElementById('list')!.addEventListener('click', () => {
          document.getElementById('clicks')!.textContent = '1';
        });
        document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', () => {
          document.getElementById('notice')!.style.display = 'none';
        });
        document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', () => {
          document.getElementById('claimed')!.textContent = '1';
        });
      });
      await installSignInNoticeHandler(page);
      const list = page.locator('#list');
      await list.click({ trial: true });
      // 模拟首屏已可操作，但异步请求稍后才显示提示的实际失败场景。
      await page.evaluate(() => { document.getElementById('notice')!.style.display = 'block'; });
      await scroll(page, list, touch);
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.locator('#clicks')).toHaveText('0');
      await expect(page.locator('#claimed')).toHaveText('0');
      // 同一种提示重复出现仍失败，不能无限吞掉异常。
      await page.evaluate(() => { document.getElementById('notice')!.style.display = 'block'; });
      await expect(list.click({ trial: true, timeout: 1_000 })).rejects.toThrow();
      expect(await page.getByRole('dialog').isVisible()).toBe(true);
    });
  }
});

test('延迟处理器遇到未知提示立即失败并保留提示', async ({ page }) => {
  await page.setContent(`
    <button id="target">俱乐部</button>
    <div role="dialog" style="position:fixed;inset:0;background:white">
      <p data-testid="alert-message-text">账号登录失败</p>
      <button data-testid="alert-custom-button">确认</button>
    </div>
  `);
  await installSignInNoticeHandler(page);
  await expect(page.locator('#target').click({ trial: true, timeout: 1_000 })).rejects.toThrow();
  expect(await page.getByRole('dialog').isVisible()).toBe(true);
  // 业务错误案例仍应能主动确认自己验证的提示，自动处理器不能抢占此操作。
  await page.evaluate(() => {
    document.querySelector('[data-testid="alert-custom-button"]')!.addEventListener('click', () => {
      document.querySelector('[role="dialog"]')!.remove();
    });
  });
  await page.getByTestId('alert-custom-button').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const privacyOnTop of [true, false]) {
  test(`${privacyOnTop ? '隐私' : '救济金'}弹窗在上层时，按遮挡顺序关闭两个提示`, async ({ page }) => {
    await page.setContent(`
      <button id="target">进入大厅</button><p id="result"></p><p id="claimed">0</p>
      <div id="privacy" style="position:fixed;inset:0;background:white;z-index:${privacyOnTop ? 20 : 10}">
        <p data-testid="privacy-popup-title">用户隐私策略概要</p>
        <p data-testid="privacy-popup-content">隐私政策</p>
        <button data-testid="privacy-popup-agree">同意</button>
      </div>
      <div id="relief" style="position:fixed;inset:0;background:white;z-index:${privacyOnTop ? 10 : 20}">
        <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
        <button data-testid="alert-custom-button">取消</button>
        <button data-testid="alert-custom-button">确认</button>
      </div>
    `);
    await page.evaluate(() => {
      document.querySelector('[data-testid="privacy-popup-agree"]')!.addEventListener('click', () => {
        document.getElementById('privacy')!.remove();
      });
      document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', () => {
        document.getElementById('relief')!.remove();
      });
      document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', () => {
        document.getElementById('claimed')!.textContent = '1';
      });
      document.getElementById('target')!.addEventListener('click', () => {
        document.getElementById('result')!.textContent = '已进入大厅';
      });
    });
    await installSignInNoticeHandler(page);
    await page.locator('#target').click();
    await expect(page.locator('#result')).toHaveText('已进入大厅');
    await expect(page.locator('#claimed')).toHaveText('0');
    await expect(page.locator('#privacy, #relief')).toHaveCount(0);
  });
}

test('取消救济金后节点立即复用为业务错误，保留错误并允许案例主动确认', async ({ page }) => {
  await page.setContent(`
    <div role="dialog" style="position:fixed;inset:0;background:white">
      <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
      <button data-testid="alert-custom-button">取消</button>
      <button data-testid="alert-custom-button">确认</button>
    </div>
  `);
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', () => {
      document.querySelector('[data-testid="alert-message-text"]')!.textContent = 'Network Error';
      document.querySelectorAll('[data-testid="alert-custom-button"]')[0].remove();
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', () => {
      document.querySelector('[role="dialog"]')!.remove();
    });
  });
  await installSignInNoticeHandler(page);
  await expect(page.getByTestId('alert-message-text').filter({ hasText: '3000个免费的金币' })).not.toBeVisible();
  await expect(page.getByTestId('alert-message-text')).toHaveText('Network Error');
  await page.getByTestId('alert-custom-button').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('救济金在业务面板下方时先正常关闭面板，再取消救济金', async ({ page }) => {
  await page.setContent(`
    <button id="target">大厅</button><p id="result"></p>
    <div id="relief" style="position:fixed;inset:0;background:white;z-index:10">
      <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
      <button data-testid="alert-custom-button">取消</button>
      <button data-testid="alert-custom-button">确认</button>
    </div>
    <div id="panel" style="position:fixed;inset:0;background:white;z-index:20">
      <button id="close-panel">关闭抽奖面板</button>
    </div>
  `);
  await page.evaluate(() => {
    document.getElementById('close-panel')!.addEventListener('click', () => {
      document.getElementById('panel')!.remove();
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', () => {
      document.getElementById('relief')!.remove();
    });
    document.getElementById('target')!.addEventListener('click', () => {
      document.getElementById('result')!.textContent = '回到大厅';
    });
  });
  await installSignInNoticeHandler(page);
  await expect(page.locator('#close-panel')).toBeVisible();
  await page.locator('#close-panel').click();
  await page.locator('#target').click();
  await expect(page.locator('#result')).toHaveText('回到大厅');
  await expect(page.locator('#panel, #relief')).toHaveCount(0);
});
