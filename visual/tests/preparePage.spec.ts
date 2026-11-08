// 验证截图准备流程的真实浏览器行为，防止稳定化逻辑改变页面或掩盖图标裁切。
import { expect, test } from '../src/support/diagnosticTest';
import { assertMatchingArtworkVisible, scrollVisualReadyElementIntoView } from '../src/support/pageStabilizers';
import type { VisualScenario } from '../scenarios';
import {
  ensureAppReadyPastStaging,
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

/** 回归防护：ensureSelectorGone 的最终兜底（按 aria-label 摘除 sheet/backdrop）曾错误地 隐藏「选择器最近公共祖先」，在 RN Web 下（App 挂在单一 #root，BottomSheet 非顶层 portal） 把整个 #root 一起摘掉，导致截图全白。这里用与真实 DOM 同构的 fixture （sheet 与 backdrop 是 #root 下两棵不相交子树，最近公共祖先就是 #root 本身）验证： 摘除 sheet/backdrop 后，#root 下其余 App 内容必须仍然可见。 */
const FIXTURE_HTML = `
  <div id="root">
    <div data-testid="app-content">hall content still here</div>
    <div aria-label="Bottom Sheet">
      <div data-testid="select-game-category-text">选择玩法</div>
    </div>
    <button role="button" aria-label="Bottom sheet backdrop"></button>
  </div>
`;

test('大厅图标检查拒绝横向限宽造成的纵向裁切', /** 验证大厅图标检查拒绝横向限宽造成的纵向裁切。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(`
    <div data-testid="hall-content-list">
      <div style="position:relative; margin-top:30px; width:390px; height:60px">
        <div data-testid="matching-title-switch-button"
          style="position:absolute; bottom:0; width:95px; height:80px"></div>
      </div>
      <div style="position:relative; margin-top:30px; width:350px; height:60px">
        <div data-testid="matching-title-switch-button"
          style="position:absolute; bottom:0; width:95px; height:80px"></div>
      </div>
    </div>
  `);
  await assertMatchingArtworkVisible(page);
  await lockPageWidth(page, 375);
  await expect(assertMatchingArtworkVisible(page)).rejects.toThrow('扑克牌图标被祖先容器裁切');
});

test('已可见的长列表不会因就绪滚动推走返回栏，屏外标记仍会滚入视口', /** 验证已可见的长列表不会因就绪滚动推走返回栏，屏外标记仍会滚入视口。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(`
    <div data-testid="navigation" style="height:812px;overflow:hidden">
      <header style="height:64px">返回</header>
      <div data-testid="long-list" style="height:3000px">国家区号列表</div>
      <button data-testid="offscreen-ready">就绪</button>
    </div>
  `);
  await scrollVisualReadyElementIntoView(page.getByTestId('long-list'));
  await expect(page.getByTestId('navigation')).toHaveJSProperty('scrollTop', 0);
  await expect(page.locator('header')).toBeInViewport();
  await scrollVisualReadyElementIntoView(page.getByTestId('offscreen-ready'));
  await expect(page.getByTestId('offscreen-ready')).toBeInViewport();
});

test('startup proxy failures retry initialization before entering the hall', /** 验证启动代理失败会先重试初始化，再进入大厅。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setContent(`
    <div data-testid="startup-alert">
      ServerType: staging Message: server_down
      <button data-testid="alert-custom-button" id="cancel">取消</button>
      <button data-testid="alert-custom-button" id="retry">重试</button>
    </div>
  `);
  await page.evaluate(/** 绑定取消与重试按钮，构造应用启动提示的两条恢复路径。 */ () => {
    /** 记录取消按钮已被点击，验证启动提示的处理分支。 */
    document.getElementById('cancel')!.onclick = /** 记录取消按钮已点击，供启动提示分支断言使用。 */ () => {
      document.body.dataset.cancelled = 'true';
    };
    /** 模拟重试成功后挂载大厅，验证启动提示能恢复应用。 */
    document.getElementById('retry')!.onclick = /** 重试后挂载大厅，模拟应用恢复成功。 */ () => {
      document.body.innerHTML = '<div data-testid="hall-screen">Hall</div>';
    };
  });
  await ensureAppReadyPastStaging(page);
  await expect(page.getByTestId('hall-screen')).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-cancelled', 'true');
});

test('login credentials are refilled when a late form initializer clears them', /** 验证迟到的表单初始化清空凭据后登录辅助会重新填写。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({
  page,
}) => {
  await page.setContent(`
    <input data-testid="username-input" />
    <div data-testid="password-input"><input type="password" /></div>
  `);
  await page.evaluate(/** 监听首次输入并延迟清空表单，复现登录框重渲染丢值。 */ () => {
    const username = document.querySelector<HTMLInputElement>('[data-testid="username-input"]')!;
    const password = document.querySelector<HTMLInputElement>(
      '[data-testid="password-input"] input',
    )!;
    let shouldReset = true;
    for (const input of [username, password]) {
      input.addEventListener('input', /** 仅在首次输入后安排表单重置，验证登录辅助能重新填写。 */ () => {
        if (!shouldReset) {
          return;
        }
        shouldReset = false;
        setTimeout(/** 清空用户名与密码，模拟应用初始化导致的表单重置。 */ () => {
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

test('username sign-in selects the form submit button by its dedicated native id', /** 验证用户名登录使用专属原生标识定位提交按钮。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({
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

test('username sign-in waits for the controlled form submit button to become enabled', /** 验证用户名登录会等待受控表单的提交按钮启用。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({
  page,
}) => {
  await page.setContent(
    '<button id="username-or-email-submit-button" aria-disabled="true">username</button>',
  );
  await page.evaluate(/** 延迟解除提交按钮禁用状态，验证登录操作会等待按钮可用。 */ () => {
    setTimeout(/** 移除提交按钮的禁用属性，模拟校验完成。 */ () => {
      document.getElementById('username-or-email-submit-button')?.removeAttribute('aria-disabled');
    }, 50);
  });

  const submit = page.locator('#username-or-email-submit-button');
  await waitForUsernameOrEmailSubmitEnabled(submit);

  await expect(submit).toBeEnabled();
});

test('ensureSelectorGone hides only the sheet + backdrop, not the whole #root', /** 验证残留面板清理只隐藏面板与遮罩，保留应用根节点。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({
  page,
}) => {
  await page.setContent(FIXTURE_HTML);

  await ensureSelectorGone(page, '[data-testid="select-game-category-text"]');

  await expect(page.locator('[data-testid="select-game-category-text"]')).toBeHidden();
  await expect(page.getByRole('button', { name: /Bottom sheet backdrop/i })).toBeHidden();
  // 回归断言：与选中目标同在 #root 下的其余 App 内容不能被一并摘掉
  await expect(page.locator('[data-testid="app-content"]')).toBeVisible();
});

test('ensureSelectorGone is a no-op when the selector is already gone', /** 验证目标弹层已经消失时清理操作无需再修改页面。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setContent(`
    <div id="root">
      <div data-testid="app-content">hall content still here</div>
    </div>
  `);

  await ensureSelectorGone(page, '[data-testid="select-game-category-text"]');

  await expect(page.locator('[data-testid="app-content"]')).toBeVisible();
});

test('lockPageWidth preserves the sprite canvas while clipping ordinary overflow', /** 验证宽度锁定保留牌面画布，仅裁切普通溢出内容。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({
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

/** 俱乐部「更多」是 RN Modal/PopUp，不是 BottomSheet：导航到搜索页后弹层常因 Modal portal 残留而仍可见。兜底必须直接隐藏匹配节点，并摘除祖先 popup-backdrop。 */
test('ensureSelectorGone hides non-BottomSheet PopUp overlays without touching #root', /** 验证普通 PopUp 遮罩会被清理且应用根节点仍保留。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({
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

test('revealVirtualizedSettingsItem scrolls the settings list until its cell is mounted', /** 验证设置列表会滚动到虚拟化的目标入口实际挂载。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({
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
  await page.locator('#visible-settings-list').evaluate(/** 为可见设置列表绑定滚动后挂载商城项的虚拟化行为。
 * @param el - 当前匹配的页面元素。 */ (el) => {
    el.addEventListener('scroll', /** 首次滚动时创建商城按钮，模拟虚拟列表项进入 DOM。 */ () => {
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
    .poll(/** 重复读取`page.locator('#hidden-settings-list').evaluate((el) => el.scrollTop)`，直到满足外层等待断言。 */ () => page.locator('#hidden-settings-list').evaluate(/** 在页面中读取`el.scrollTop`，供测试判断当前界面状态。
 * @param el - 当前匹配的页面元素。 */ (el) => el.scrollTop))
    .toBe(0);
  await expect
    .poll(/** 重复读取`page.locator('#visible-settings-list').evaluate((el) => el.scrollTop)`，直到满足外层等待断言。 */ () => page.locator('#visible-settings-list').evaluate(/** 在页面中读取`el.scrollTop`，供测试判断当前界面状态。
 * @param el - 当前匹配的页面元素。 */ (el) => el.scrollTop))
    .toBeGreaterThan(0);
});

test('resetScrollToStart clears only the current visible list scroll offset', /** 验证滚动复位只清除当前可见列表的偏移。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setContent(`
    <div data-testid="hall-content-list" id="hidden-hall-list" style="visibility:hidden; height:100px; overflow:auto">
      <div style="height:1000px"></div>
    </div>
    <div data-testid="hall-content-list" id="visible-hall-list" style="height:100px; overflow:auto">
      <div style="height:1000px"></div>
    </div>
  `);
  await page.locator('#hidden-hall-list').evaluate(/** 设置隐藏大厅的滚动位置，验证复位只影响可见列表。
 * @param el - 当前匹配的页面元素。 */ (el) => {
    el.scrollTop = 80;
  });
  await page.locator('#visible-hall-list').evaluate(/** 设置当前可见大厅的滚动位置，准备复位断言。
 * @param el - 当前匹配的页面元素。 */ (el) => {
    el.scrollTop = 129;
  });

  await resetScrollToStart(page, '[data-testid="hall-content-list"]');

  await expect
    .poll(/** 重复读取`page.locator('#visible-hall-list').evaluate((el) => el.scrollTop)`，直到满足外层等待断言。 */ () => page.locator('#visible-hall-list').evaluate(/** 在页面中读取`el.scrollTop`，供测试判断当前界面状态。
 * @param el - 当前匹配的页面元素。 */ (el) => el.scrollTop))
    .toBe(0);
  await expect
    .poll(/** 重复读取`page.locator('#hidden-hall-list').evaluate((el) => el.scrollTop)`，直到满足外层等待断言。 */ () => page.locator('#hidden-hall-list').evaluate(/** 在页面中读取`el.scrollTop`，供测试判断当前界面状态。
 * @param el - 当前匹配的页面元素。 */ (el) => el.scrollTop))
    .toBe(80);
});

test('applyContentStabilizers survives late React-style rerenders', /** 验证内容稳定化规则能在 React 迟到重绘后重新应用。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.setContent(`
    <div data-testid="current-server-text">69</div>
    <div data-testid="new-version-need-update-text">有新版本</div>
  `);
  await applyContentStabilizers(page, {
    fixedTexts: [{ selector: '[data-testid="current-server-text"]', text: '0' }],
    hideSelectors: ['[data-testid="new-version-need-update-text"]'],
  } as VisualScenario);

  await page.evaluate(/** 替换服务器编号节点，验证固定文案在 React 重绘后仍会恢复。 */ () => {
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

test('ensureLocalImagesLoaded accepts a decoded same-origin WebP asset', /** 验证图片就绪等待接受已完成解码的同源 WebP。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  // 两个不透明像素（红、绿）的无损 WebP，交给浏览器真实解码。
  const webpImage = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAA+w//Mf8x8VMqL/AQA=', 'base64');
  await page.route('http://visual.test/**', /** 提供页面和本地 WebP 资源，验证图片就绪辅助的正常路径。
 * @param route - 当前拦截的网络请求。 */ async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      await route.fulfill({
        contentType: 'text/html',
        body: '<img src="/visual-asset.webp" alt="WebP">',
      });
      return;
    }
    await route.fulfill({ contentType: 'image/webp', body: webpImage });
  });
  await page.goto('http://visual.test/');
  await ensureLocalImagesLoaded(page);
  await expect(page.getByAltText('WebP')).toBeVisible();
  expect(await page.getByAltText('WebP').evaluate(/** 在页面中读取`{ width: image.naturalWidth, height: image.naturalHeight, }`，供测试判断当前界面状态。
 * @param image - 当前操作使用的 image。 */ (image: HTMLImageElement) => ({
    width: image.naturalWidth, height: image.naturalHeight,
  }))).toEqual({ width: 2, height: 1 });
});
test('ensureLocalImagesLoaded retries a dropped same-origin image once', /** 验证同源图片丢失连接时仅重试一次。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  const webpImage = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAA+w//Mf8x8VMqL/AQA=', 'base64');
  let imageRequests = 0;
  await page.route('http://visual.test/**', /** 首次图片请求失败、重试成功，验证仅执行一次的资源恢复。
 * @param route - 当前拦截的网络请求。 */ async (route) => {
    if (new URL(route.request().url()).pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: '<img src="/visual-asset.webp" alt="WebP">' });
      return;
    }
    imageRequests++;
    if (imageRequests === 1) await route.abort('failed');
    else await route.fulfill({ contentType: 'image/webp', body: webpImage });
  });
  await page.goto('http://visual.test/');
  await ensureLocalImagesLoaded(page);
  expect(imageRequests).toBe(2);
  expect(await page.getByAltText('WebP').evaluate(/** 在页面中读取`image.naturalWidth`，供测试判断当前界面状态。
 * @param image - 当前操作使用的 image。 */ (image: HTMLImageElement) => image.naturalWidth)).toBe(2);
});
for (const asset of [
  { name: 'missing-visual-asset.png', status: 404, contentType: 'image/png' },
  { name: 'missing-visual-asset.webp', status: 404, contentType: 'image/webp' },
  { name: 'corrupt-visual-asset.webp', status: 200, contentType: 'image/webp' },
]) {
  test(`ensureLocalImagesLoaded rejects ${asset.name} (HTTP ${asset.status})`, /** 验证当前损坏资源及其 HTTP 状态会使图片就绪检查失败。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
    await page.route('http://visual.test/**', /** 对指定损坏资源返回失败响应，验证不同图片类型的错误传播。
 * @param route - 当前拦截的网络请求。 */ async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') {
        await route.fulfill({
          contentType: 'text/html',
          body: `<img src="/${asset.name}" alt="broken">`,
        });
        return;
      }
      await route.fulfill({ status: asset.status, contentType: asset.contentType, body: 'invalid image' });
    });
    await page.goto('http://visual.test/');
    await expect(ensureLocalImagesLoaded(page)).rejects.toThrow(
      `本地图片加载失败: /${asset.name}`,
    );
  });
}
