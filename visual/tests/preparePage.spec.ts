import { expect, test } from '@playwright/test';
import type { VisualScenario } from '../scenarios';
import {
  fillStableSignInCredentials,
  usernameOrEmailSubmitButton,
  waitForUsernameOrEmailSubmitEnabled,
} from '../src/support/authFlow';
import {
  applyContentStabilizers,
  ensureLocalImagesLoaded,
  ensureSelectorGone,
  lockPageWidth,
  resetScrollToStart,
  revealVirtualizedSettingsItem,
} from '../src/support/preparePage';

/**
 * 回归防护：ensureSelectorGone 的最终兜底（按 aria-label 摘除 sheet/backdrop）曾错误地
 * 隐藏「选择器最近公共祖先」，在 RN Web 下（App 挂在单一 #root，BottomSheet 非顶层 portal）
 * 把整个 #root 一起摘掉，导致截图全白。这里用与真实 DOM 同构的 fixture
 * （sheet 与 backdrop 是 #root 下两棵不相交子树，最近公共祖先就是 #root 本身）验证：
 * 摘除 sheet/backdrop 后，#root 下其余 App 内容必须仍然可见。
 */
const FIXTURE_HTML = `
  <div id="root">
    <div data-testid="app-content">hall content still here</div>
    <div aria-label="Bottom Sheet">
      <div data-testid="select-game-category-text">选择玩法</div>
    </div>
    <button role="button" aria-label="Bottom sheet backdrop"></button>
  </div>
`;

test('login credentials are refilled when a late form initializer clears them', async ({
  page,
}) => {
  await page.setContent(`
    <input data-testid="username-input" />
    <div data-testid="password-input"><input type="password" /></div>
  `);
  await page.evaluate(() => {
    const username = document.querySelector<HTMLInputElement>('[data-testid="username-input"]')!;
    const password = document.querySelector<HTMLInputElement>(
      '[data-testid="password-input"] input',
    )!;
    let shouldReset = true;
    for (const input of [username, password]) {
      input.addEventListener('input', () => {
        if (!shouldReset) {
          return;
        }
        shouldReset = false;
        setTimeout(() => {
          username.value = '';
          password.value = '';
        }, 50);
      });
    }
  });

  await fillStableSignInCredentials(page, { username: 'visual-user', password: 'visual-password' });

  await expect(page.locator('[data-testid="username-input"]')).toHaveValue('visual-user');
  await expect(page.locator('[data-testid="password-input"] input')).toHaveValue('visual-password');
});

test('username sign-in selects the form submit button by its dedicated native id', async ({
  page,
}) => {
  await page.setContent(`
    <button data-testid="sign-in-button" id="home-submit">home</button>
    <div><input data-testid="username-input" /></div>
    <div data-testid="password-input"><input type="password" /></div>
    <button data-testid="sign-in-button" id="username-or-email-submit-button">username</button>
  `);

  const submit = await usernameOrEmailSubmitButton(page);

  await expect(submit).toHaveAttribute('id', 'username-or-email-submit-button');
});

test('username sign-in waits for the controlled form submit button to become enabled', async ({
  page,
}) => {
  await page.setContent(
    '<button id="username-or-email-submit-button" aria-disabled="true">username</button>',
  );
  await page.evaluate(() => {
    setTimeout(() => {
      document.getElementById('username-or-email-submit-button')?.removeAttribute('aria-disabled');
    }, 50);
  });

  const submit = page.locator('#username-or-email-submit-button');
  await waitForUsernameOrEmailSubmitEnabled(submit);

  await expect(submit).toBeEnabled();
});

test('ensureSelectorGone hides only the sheet + backdrop, not the whole #root', async ({
  page,
}) => {
  await page.setContent(FIXTURE_HTML);

  await ensureSelectorGone(page, '[data-testid="select-game-category-text"]');

  await expect(page.locator('[data-testid="select-game-category-text"]')).toBeHidden();
  await expect(page.getByRole('button', { name: /Bottom sheet backdrop/i })).toBeHidden();
  // 回归断言：与选中目标同在 #root 下的其余 App 内容不能被一并摘掉
  await expect(page.locator('[data-testid="app-content"]')).toBeVisible();
});

test('ensureSelectorGone is a no-op when the selector is already gone', async ({ page }) => {
  await page.setContent(`
    <div id="root">
      <div data-testid="app-content">hall content still here</div>
    </div>
  `);

  await ensureSelectorGone(page, '[data-testid="select-game-category-text"]');

  await expect(page.locator('[data-testid="app-content"]')).toBeVisible();
});

test('lockPageWidth preserves the sprite canvas while clipping ordinary overflow', async ({
  page,
}) => {
  await page.setContent(`
    <div data-testid="ordinary-overflow" style="width: 1600px"></div>
    <div data-testid="sprite-image-container" style="width: 1600px">
      <div data-testid="sprite-image-view" style="width: 1600px">
        <img data-testid="sprite-image-canvas" style="width: 1600px" />
      </div>
    </div>
  `);

  await lockPageWidth(page, 375);

  await expect(page.locator('[data-testid="ordinary-overflow"]')).toHaveCSS('max-width', '375px');
  await expect(page.locator('[data-testid="ordinary-overflow"]')).toHaveCSS('overflow-x', 'hidden');
  await expect(page.locator('[data-testid="sprite-image-view"]')).toHaveCSS('width', '1600px');
  await expect(page.locator('[data-testid="sprite-image-view"]')).toHaveCSS('max-width', 'none');
  await expect(page.locator('[data-testid="sprite-image-container"]')).toHaveCSS(
    'max-width',
    'none',
  );
  await expect(page.locator('[data-testid="sprite-image-canvas"]')).toHaveCSS('width', '1600px');
  await expect(page.locator('[data-testid="sprite-image-canvas"]')).toHaveCSS('max-width', 'none');
});

/**
 * 俱乐部「更多」是 RN Modal/PopUp，不是 BottomSheet：导航到搜索页后弹层常因
 * Modal portal 残留而仍可见。兜底必须直接隐藏匹配节点，并摘除祖先 popup-backdrop。
 */
test('ensureSelectorGone hides non-BottomSheet PopUp overlays without touching #root', async ({
  page,
}) => {
  await page.setContent(`
    <div id="root">
      <div data-testid="app-content">search page still here</div>
      <div data-testid="popup-backdrop">
        <div data-testid="popup-content-container">
          <div data-testid="club-more-popup">创建俱乐部 / 搜索俱乐部</div>
        </div>
      </div>
    </div>
  `);

  await ensureSelectorGone(page, '[data-testid="club-more-popup"]');

  await expect(page.locator('[data-testid="club-more-popup"]')).toBeHidden();
  await expect(page.locator('[data-testid="popup-backdrop"]')).toBeHidden();
  await expect(page.locator('[data-testid="app-content"]')).toBeVisible();
});

test('revealVirtualizedSettingsItem scrolls the settings list until its cell is mounted', async ({
  page,
}) => {
  await page.setContent(`
    <div data-testid="settings-list" id="hidden-settings-list" style="display: none; height: 100px; overflow: auto">
      <div style="height: 1200px"></div>
    </div>
    <div data-testid="settings-list" id="visible-settings-list" style="height: 100px; overflow: auto">
      <div style="height: 1200px"></div>
    </div>
  `);
  await page.locator('#visible-settings-list').evaluate((el) => {
    el.addEventListener('scroll', () => {
      if (!document.querySelector('[data-testid="mall"]')) {
        const item = document.createElement('button');
        item.dataset.testid = 'mall';
        document.body.appendChild(item);
      }
    });
  });

  const mall = page.locator('[data-testid="mall"]:visible').last();
  await revealVirtualizedSettingsItem(page, mall);

  await expect(mall).toBeAttached();
  await expect
    .poll(() => page.locator('#hidden-settings-list').evaluate((el) => el.scrollTop))
    .toBe(0);
  await expect
    .poll(() => page.locator('#visible-settings-list').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
});

test('resetScrollToStart clears only the current visible list scroll offset', async ({ page }) => {
  await page.setContent(`
    <div data-testid="hall-content-list" id="hidden-hall-list" style="visibility:hidden; height:100px; overflow:auto">
      <div style="height:1000px"></div>
    </div>
    <div data-testid="hall-content-list" id="visible-hall-list" style="height:100px; overflow:auto">
      <div style="height:1000px"></div>
    </div>
  `);
  await page.locator('#hidden-hall-list').evaluate((el) => {
    el.scrollTop = 80;
  });
  await page.locator('#visible-hall-list').evaluate((el) => {
    el.scrollTop = 129;
  });

  await resetScrollToStart(page, '[data-testid="hall-content-list"]');

  await expect
    .poll(() => page.locator('#visible-hall-list').evaluate((el) => el.scrollTop))
    .toBe(0);
  await expect
    .poll(() => page.locator('#hidden-hall-list').evaluate((el) => el.scrollTop))
    .toBe(80);
});

test('applyContentStabilizers survives late React-style rerenders', async ({ page }) => {
  await page.setContent(`
    <div data-testid="current-server-text">69</div>
    <div data-testid="new-version-need-update-text">有新版本</div>
  `);
  await applyContentStabilizers(page, {
    fixedTexts: [{ selector: '[data-testid="current-server-text"]', text: '0' }],
    hideSelectors: ['[data-testid="new-version-need-update-text"]'],
  } as VisualScenario);

  await page.evaluate(() => {
    const replacement = document.createElement('div');
    replacement.dataset.testid = 'current-server-text';
    replacement.textContent = '88';
    document.querySelector('[data-testid="current-server-text"]')?.replaceWith(replacement);
    const version = document.querySelector(
      '[data-testid="new-version-need-update-text"]',
    ) as HTMLElement | null;
    version?.style.removeProperty('display');
  });

  await expect(page.locator('[data-testid="current-server-text"]')).toHaveText('0');
  await expect(page.locator('[data-testid="new-version-need-update-text"]')).toBeHidden();
});

test('ensureLocalImagesLoaded rejects a missing same-origin asset', async ({ page }) => {
  await page.route('http://visual.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      await route.fulfill({
        contentType: 'text/html',
        body: '<img src="/missing-visual-asset.png" alt="missing">',
      });
      return;
    }
    await route.fulfill({ status: 404, body: 'missing' });
  });
  await page.goto('http://visual.test/');

  await expect(ensureLocalImagesLoaded(page)).rejects.toThrow(
    '本地图片加载失败: /missing-visual-asset.png',
  );
});
