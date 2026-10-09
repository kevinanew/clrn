import { expect, openApp, test } from './fixtures';
import { drag, scroll } from './gestures';

test('大厅滚动后可返回顶部并打开搜索', /**
 * 验证大厅上下滚动和滚动后的点击。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
  isMobile,
}) => {
  await openApp(page);
  const list = page.getByTestId('hall-content-list');
  await expect
    .poll(
      /** 读取实际内容溢出高度。 */ () =>
        list.evaluate(/**
         * 计算可滚动距离。
         * @param el - 当前查询布局或滚动位置的 DOM 元素。
         */ (el) => el.scrollHeight - el.clientHeight),
    )
    .toBeGreaterThan(30);
  await scroll(page, list, isMobile);
  await expect
    .poll(/** 读取实际滚动位置。 */ () => list.evaluate(/**
     * 返回纵向偏移。
     * @param el - 当前查询布局或滚动位置的 DOM 元素。
     */ (el) => el.scrollTop))
    .toBeGreaterThan(30);
  await scroll(page, list, isMobile, -1);
  await expect
    .poll(/** 读取实际滚动位置。 */ () => list.evaluate(/**
     * 返回纵向偏移。
     * @param el - 当前查询布局或滚动位置的 DOM 元素。
     */ (el) => el.scrollTop))
    .toBeLessThan(5);
  await page.getByTestId('hall-search-button').click();
  await expect(page.getByTestId('club-search-input')).toBeVisible();
});

test('选择玩法弹层关闭后仍能打开建房表单并拖动滑块', /**
 * 验证弹层正常关闭及滑块拖动的数值变化。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
  isMobile,
}) => {
  await openApp(page);
  await page.getByTestId('private-room-tab').click();
  await expect(page.getByTestId('copy-house-number-button')).toBeVisible();
  const sheet = page.getByTestId('select-game-category-text');
  const create = page.getByTestId('create-game-button');
  if (!(await sheet.isVisible())) {
    await create.click();
  }
  await expect(sheet).toBeVisible();
  const backdrop = page.getByRole('button', { name: /Bottom sheet backdrop/i });
  await backdrop.click({ position: { x: 15, y: 15 } });
  await expect(sheet).toBeHidden();
  await expect(backdrop).toBeHidden();
  await create.click();
  await page.getByTestId('game-type-button-texas_react_native').click();
  await expect(sheet).toBeHidden();
  await expect(backdrop).toBeHidden();
  await expect(page.getByTestId('base-create-room-screen')).toBeVisible();
  const slider = page.getByRole('slider').first();
  const track = slider.locator('xpath=ancestor::span[contains(@class,"MuiSlider-root")]');
  await expect(track).toBeInViewport();
  const box = await track.boundingBox();
  if (!box) {
    throw new Error('滑块轨道没有布局区域');
  }
  const value = page.getByTestId('small-big-blind-value-text');
  const original = await value.innerText();
  const y = box.y + box.height / 2;
  await drag(page, { x: box.x + 2, y }, { x: box.x + box.width - 2, y }, isMobile);
  await expect(value).not.toHaveText(original);
  const max = await slider.getAttribute('aria-valuemax');
  if (max === null) {
    throw new Error('滑块缺少上限');
  }
  await expect(slider).toHaveAttribute('aria-valuenow', max);
  await drag(page, { x: box.x + box.width - 2, y }, { x: box.x + 2, y }, isMobile);
  const min = await slider.getAttribute('aria-valuemin');
  if (min === null) {
    throw new Error('滑块缺少下限');
  }
  await expect(slider).toHaveAttribute('aria-valuenow', min);
  await expect(value).toHaveText(`${min} / ${Number(min) * 2}`);
});

test('俱乐部请求失败后点击重试恢复列表并可打开菜单', /**
 * 验证故障恢复后重新请求并恢复页面操作。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
}) => {
  await openApp(page);
  let failing = true;
  let requests = 0;
  await page.route(
    /**
     * 仅拦截当前用户的俱乐部列表请求。
     * @param url - 请求地址，用于限定当前用户的俱乐部列表接口。
     */ (url) =>
      url.pathname === '/v10/club' && url.searchParams.has('user_id'),
    /**
     * 注入故障，恢复后返回成功空列表。
     * @param route - 当前拦截到的请求，用于提供场景响应。
     */ async (route) => {
      requests += 1;
      if (failing) {
        await route.abort('failed');
      } else {
        await route.fulfill({ json: { ok: true, result: { clubs: [] } } });
      }
    },
  );
  await page.getByTestId('club-tab').click();
  await expect(page.getByTestId('club-list-load-error')).toBeVisible({ timeout: 45_000 });
  const failedRequests = requests;
  failing = false;
  const recovered = page.waitForResponse(
    /**
     * 等待重试接口成功响应。
     * @param response - 待判断是否属于成功重试的网络响应。
     */ (response) => {
      const url = new URL(response.url());
      return url.pathname === '/v10/club' && url.searchParams.has('user_id') && response.ok();
    },
  );
  await page.getByTestId('club-list-retry-button').click();
  await recovered;
  await expect.poll(/** 读取俱乐部请求次数。 */ () => requests).toBeGreaterThan(failedRequests);
  await expect(page.getByTestId('club-list-load-error')).toBeHidden();
  await expect(page.getByTestId('club-list-screen-flatlist')).toBeVisible();
  await page.getByTestId('show-more-button').click();
  await expect(page.getByTestId('club-more-popup')).toBeVisible();
  await page.getByRole('dialog').getByTestId('search-club-button').click();
  await expect(page.getByTestId('club-more-popup')).toBeHidden();
  const input = page
    .locator('input[data-testid="club-search-input"], [data-testid="club-search-input"] input')
    .first();
  await input.click();
  await page.keyboard.type('交互回归');
  await expect(input).toHaveValue('交互回归');
});

test('大厅接口失败后点击重试恢复页面操作', /**
 * 验证重试真正重新请求并关闭错误提示。
 * @param fixtures - Playwright 注入的页面、浏览器或账号会话等依赖。
 */ async ({
  page,
}) => {
  let failing = true;
  let requests = 0;
  await page.route(
    '**/public/v1/hall_matching/available.json',
    /**
     * 按当前故障阶段返回失败或成功。
     * @param route - 当前拦截到的请求，用于提供场景响应。
     */ async (route) => {
      requests += 1;
      if (failing) {
        await route.abort('failed');
      } else {
        await route.fulfill({ json: { ok: true, result: { available_url_version: ['v3'] } } });
      }
    },
  );
  await openApp(page);
  await expect(page.getByTestId('hall-api-error-alert')).toBeVisible({ timeout: 45_000 });
  const failedRequests = requests;
  failing = false;
  const recovered = page.waitForResponse(
    /**
     * 等待大厅重试接口成功响应。
     * @param response - 待判断是否属于成功重试的网络响应。
     */ (response) =>
      new URL(response.url()).pathname === '/public/v1/hall_matching/available.json' &&
      response.ok(),
  );
  await page.getByTestId('hall-api-retry-button').click();
  await recovered;
  await expect.poll(/** 读取恢复后的请求次数。 */ () => requests).toBeGreaterThan(failedRequests);
  await expect(page.getByTestId('hall-api-error-alert')).toBeHidden();
  await page.getByTestId('settings-tab').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
});
