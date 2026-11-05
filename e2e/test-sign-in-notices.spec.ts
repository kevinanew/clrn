import { expect, test } from '@playwright/test';
import { clickAfterSignInNotices, installSignInNoticeHandler } from './cases/_shared/sign-in-notices';
import { scroll } from './interactions/gestures';

test('新账号救济金提示取消后才点击俱乐部，不领取资产', /** 验证新账号救济金提示取消后才点击俱乐部，不领取资产。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setContent(`
    <button data-testid="club-tab">俱乐部</button>
    <div role="dialog" style="position:fixed;inset:0;background:white">
      <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
      <button data-testid="alert-custom-button">取消</button>
      <button data-testid="alert-custom-button">确认</button>
    </div>
    <p id="result"></p>
  `);
  await page.evaluate(/** 绑定导航、关闭提示与领取资产按钮，构造登录提示交互场景。 */ () => {
    const result = document.getElementById('result')!;
    document.querySelector('[data-testid="club-tab"]')!.addEventListener('click', /** 点击俱乐部入口后显示已进入俱乐部的状态。 */ () => {
      result.textContent = '进入俱乐部';
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', /** 点击关闭按钮时移除当前提示弹窗。 */ () => {
      document.querySelector('[role="dialog"]')!.remove();
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', /** 点击领取按钮时显示资产已领取的状态。 */ () => {
      result.textContent = '领取资产';
    });
  });
  await clickAfterSignInNotices(page, 'club-tab');
  await expect(page.locator('#result')).toHaveText('进入俱乐部');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('未知登录错误保留提示并使操作失败，不强行穿过弹窗', /** 验证未知登录错误保留提示并使操作失败，不强行穿过弹窗。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
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

test.describe('登录提示延迟到原始手势之前出现', /** 覆盖登录提示延迟到原始手势之前出现。 */ () => {
  test.use({ hasTouch: true });
  for (const touch of [false, true]) {
    test(`${touch ? '触摸' : '滚轮'}滚动前取消救济金，不点击列表或领取金币`, /** 验证$\{touch ? '触摸' : '滚轮'\}滚动前取消救济金，不点击列表或领取金币。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
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
      await page.evaluate(/** 绑定列表点击与提示按钮，构造会重复出现的登录提示场景。 */ () => {
        document.getElementById('list')!.addEventListener('click', /** 记录列表已被点击，验证提示不会吞掉目标操作。 */ () => {
          document.getElementById('clicks')!.textContent = '1';
        });
        document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', /** 隐藏当前提示，使被遮挡的列表可以交互。 */ () => {
          document.getElementById('notice')!.style.display = 'none';
        });
        document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', /** 标记资产已领取，验证测试没有误点领取按钮。 */ () => {
          document.getElementById('claimed')!.textContent = '1';
        });
      });
      await installSignInNoticeHandler(page);
      const list = page.locator('#list');
      await list.click({ trial: true });
      // 模拟首屏已可操作，但异步请求稍后才显示提示的实际失败场景。
      await page.evaluate(/** 重新显示提示，验证处理器可应对再次弹出的遮挡。 */ () => { document.getElementById('notice')!.style.display = 'block'; });
      await scroll(page, list, touch);
      await expect.poll(/** 重复读取`list.evaluate((element) => element.scrollTop)`，直到满足外层等待断言。 */ () => list.evaluate(/** 在页面中读取`element.scrollTop`，供测试判断当前界面状态。
 * @param element - 当前匹配的页面元素。 */ (element) => element.scrollTop)).toBeGreaterThan(0);
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.locator('#clicks')).toHaveText('0');
      await expect(page.locator('#claimed')).toHaveText('0');
      // 同一种提示重复出现仍失败，不能无限吞掉异常。
      await page.evaluate(/** 再次展示提示，检查后续导航仍可正确处理。 */ () => { document.getElementById('notice')!.style.display = 'block'; });
      await expect(list.click({ trial: true, timeout: 1_000 })).rejects.toThrow();
      expect(await page.getByRole('dialog').isVisible()).toBe(true);
    });
  }
});

test('延迟处理器遇到未知提示立即失败并保留提示', /** 验证延迟处理器遇到未知提示立即失败并保留提示。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
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
  await page.evaluate(/** 绑定提示关闭动作，构造只有关闭按钮的弹窗场景。 */ () => {
    document.querySelector('[data-testid="alert-custom-button"]')!.addEventListener('click', /** 关闭提示后移除弹窗节点。 */ () => {
      document.querySelector('[role="dialog"]')!.remove();
    });
  });
  await page.getByTestId('alert-custom-button').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const privacyOnTop of [true, false]) {
  test(`${privacyOnTop ? '隐私' : '救济金'}弹窗在上层时，按遮挡顺序关闭两个提示`, /** 验证$\{privacyOnTop ? '隐私' : '救济金'\}弹窗在上层时，按遮挡顺序关闭两个提示。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
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
    await page.evaluate(/** 绑定隐私、救济金与大厅入口按钮，构造多个叠加提示。 */ () => {
      document.querySelector('[data-testid="privacy-popup-agree"]')!.addEventListener('click', /** 同意隐私条款后移除隐私弹窗。 */ () => {
        document.getElementById('privacy')!.remove();
      });
      document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', /** 关闭救济金提示，避免误触领取资产。 */ () => {
        document.getElementById('relief')!.remove();
      });
      document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', /** 记录领取按钮是否被触发，用于排除误操作。 */ () => {
        document.getElementById('claimed')!.textContent = '1';
      });
      document.getElementById('target')!.addEventListener('click', /** 点击目标入口后显示已进入大厅的状态。 */ () => {
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

test('取消救济金后节点立即复用为业务错误，保留错误并允许案例主动确认', /** 验证取消救济金后节点立即复用为业务错误，保留错误并允许案例主动确认。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setContent(`
    <div role="dialog" style="position:fixed;inset:0;background:white">
      <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
      <button data-testid="alert-custom-button">取消</button>
      <button data-testid="alert-custom-button">确认</button>
    </div>
  `);
  await page.evaluate(/** 构造提示内容由救济金变成网络错误的连续弹窗场景。 */ () => {
    document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', /** 将提示替换为网络错误并移除旧关闭按钮。 */ () => {
      document.querySelector('[data-testid="alert-message-text"]')!.textContent = 'Network Error';
      document.querySelectorAll('[data-testid="alert-custom-button"]')[0].remove();
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[1].addEventListener('click', /** 点击新的关闭按钮时移除网络错误弹窗。 */ () => {
      document.querySelector('[role="dialog"]')!.remove();
    });
  });
  await installSignInNoticeHandler(page);
  await expect(page.getByTestId('alert-message-text').filter({ hasText: '3000个免费的金币' })).not.toBeVisible();
  await expect(page.getByTestId('alert-message-text')).toHaveText('Network Error');
  await page.getByTestId('alert-custom-button').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('救济金在业务面板下方时先正常关闭面板，再取消救济金', /** 验证救济金在业务面板下方时先正常关闭面板，再取消救济金。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setContent(`
    <button id="target">大厅</button><p id="result"></p>
    <div id="relief" role="dialog" style="position:fixed;inset:0;background:white;z-index:10">
      <p data-testid="alert-message-text">3000个免费的金币，请收下</p>
      <button data-testid="alert-custom-button">取消</button>
      <button data-testid="alert-custom-button">确认</button>
    </div>
    <div id="panel" role="dialog" style="position:fixed;inset:0;background:white;z-index:20">
      <button>退出登录</button><button id="close-panel">取消</button>
    </div>
  `);
  await page.evaluate(/** 绑定面板和救济金提示关闭动作，验证遮挡恢复后的返回导航。 */ () => {
    document.getElementById('close-panel')!.addEventListener('click', /** 关闭当前面板，露出后面的大厅入口。 */ () => {
      document.getElementById('panel')!.remove();
    });
    document.querySelectorAll('[data-testid="alert-custom-button"]')[0].addEventListener('click', /** 移除救济金提示，恢复目标按钮的交互。 */ () => {
      document.getElementById('relief')!.remove();
    });
    document.getElementById('target')!.addEventListener('click', /** 点击目标按钮后记录已回到大厅。 */ () => {
      document.getElementById('result')!.textContent = '回到大厅';
    });
  });
  await installSignInNoticeHandler(page);
  // 两个弹层同时有“取消”，必须将操作限定在退出面板内。
  expect(await page.getByText('取消', { exact: true }).count()).toBe(2);
  const panel = page.getByRole('dialog').filter({ has: page.getByText('退出登录', { exact: true }) });
  await expect(panel).toHaveCount(1);
  await panel.getByText('取消', { exact: true }).click();
  await page.locator('#target').click();
  await expect(page.locator('#result')).toHaveText('回到大厅');
  await expect(page.locator('#panel, #relief')).toHaveCount(0);
});
