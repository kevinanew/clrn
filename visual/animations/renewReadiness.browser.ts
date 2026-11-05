/** 以离线浏览器请求验证续时准备的顺序和失败边界，不访问真实账号。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect, type Route, type Browser, type Page } from '@playwright/test';
import { openRenewPopup } from './renewReadiness';
import { press } from './appSession';

const origin = 'https://renewal.invalid';
const markup = `<button data-testid="drawer-menu-item-renew">续时</button>
  <button data-testid="renew-popup-close-button" hidden>关闭</button>
  <button data-testid="menu-button" hidden>菜单</button>
  <output id="completed">0</output><script>
    const [renew, close, menu] = document.querySelectorAll('button');
    close.onclick = () => { close.hidden = true; menu.hidden = false; };
    menu.onclick = () => { menu.hidden = true; renew.hidden = false; };
    renew.onclick = () => {
      renew.hidden = true;
      close.hidden = false;
      document.querySelector('output').textContent = '0';
      document.body.dataset.opens = String(Number(document.body.dataset.opens || 0) + 1);
      for (const [path, method] of [['/v3/pay_action/batch/price', 'POST'], ['/v10/wallet/fixture-user', 'PUT']]) {
        fetch(path, {method}).then(response => response.text()).then(() => {
          const output = document.querySelector('output');
          output.textContent = String(Number(output.textContent) + 1);
        }).catch(() => {});
      }
    };
  </script>`;

let browser: Browser;
test.before(/** 启动续时就绪测试使用的 Chromium，可选使用指定诊断浏览器。 */ async () => {
  browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
});
test.after(/** 关闭续时就绪测试的浏览器实例。 */ async () => { await browser.close(); });

/**
 * 初始化离线续时页面并固定动画时钟。
 * @param page - 已安装离线路由的页面。
 */
async function prepareRenewPage(page: Page): Promise<number> {
  await page.goto(origin);
  await expect(page.getByTestId('drawer-menu-item-renew')).toBeVisible();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  return page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now());
}

test('续时等待两项新读取，隔离旧响应，连接中断仅恢复一次', /** 验证续时等待两项新读取，隔离旧响应，连接中断仅恢复一次。
 * @param context - 当前浏览器或测试上下文。 */ async context => {
  const page = await browser.newPage();
  context.after(/** 用例结束后关闭本轮续时测试页面。 */ () => page.close());
  const pending = new Map<string, Route>();
  await page.route(`${origin}/**`, /** 提供续时测试页面，并挂起价格与钱包读取以控制响应顺序。
 * @param route - 当前拦截的网络请求。 */ route => {
    if (new URL(route.request().url()).pathname === '/') return route.fulfill({ contentType: 'text/html', body: markup });
    assert.ok(['POST', 'PUT'].includes(route.request().method()), '续时只应发出价格和钱包读取');
    pending.set(route.request().method(), route);
  });
  const before = await prepareRenewPage(page);
  await page.evaluate(/** 发起旧价格请求，验证本次打开续时弹层不会借用旧响应。 */ () => {
    void fetch('/v3/pay_action/batch/price', { method: 'POST' }).then(/** 标记旧价格请求已完成，供请求归属断言使用。 */ () => {
      (window as typeof window & { staleReadFinished: boolean }).staleReadFinished = true;
    });
  });
  await expect.poll(/** 重复读取`pending.has('POST')`，直到满足外层等待断言。 */ () => pending.has('POST')).toBe(true);
  const stale = pending.get('POST')!;
  for (const mode of ['post-first', 'put-first', 'failover', 'recover', 'persistent']) {
    const order = mode === 'put-first' ? ['PUT', 'POST'] : ['POST', 'PUT'];
    pending.clear();
    let ready = false;
    const opening = openRenewPopup(page).then(/** 标记续时弹层已等待本次价格与钱包读取完成。 */ () => { ready = true; });
    await expect.poll(/** 重复读取`pending.size`，直到满足外层等待断言。 */ () => pending.size).toBe(2);
    if (mode === 'post-first') {
      await stale.fulfill({ json: { ok: true, result: {} } });
      await expect.poll(/** 重复读取`page.evaluate(() => (window as typeof window & { staleReadFinished?: boolean }).staleReadFinished)`，直到满足外层等待断言。 */ () => page.evaluate(/** 在页面中读取`(window as typeof window & { staleReadFinished?: boolean }).staleReadFinished`，供测试判断当前界面状态。 */ () =>
        (window as typeof window & { staleReadFinished?: boolean }).staleReadFinished)).toBe(true);
      await expect(page.locator('#completed')).toHaveText('0');
      assert.equal(ready, false, '本次打开前发出的旧请求即使成功也不能作为就绪依据');
    }
    if (mode === 'failover') {
      await Promise.all([...pending.values()].map(/** 将当前条目映射为`route.abort('connectionreset')`。
 * @param route - 当前拦截的网络请求。 */ route => route.abort('connectionreset')));
      pending.clear();
      // 模拟应用选线后的自动重发，仍须等待两项真实读取，不能重开面板。
      await page.evaluate(/** 并发读取价格与钱包，模拟重复请求的完成顺序。 */ () => {
        for (const [path, method] of [['/v3/pay_action/batch/price', 'POST'], ['/v10/wallet/fixture-user', 'PUT']]) {
          void fetch(path, { method }).then(/** 每完成一个读取就递增页面计数，记录响应完成数量。 */ () => {
            const output = document.querySelector('output')!;
            output.textContent = String(Number(output.textContent) + 1);
          });
        }
      });
      await expect.poll(/** 重复读取`pending.size`，直到满足外层等待断言。 */ () => pending.size).toBe(2);
    }
    if (mode === 'recover' || mode === 'persistent') {
      await Promise.all([...pending.values()].map(/** 将当前条目映射为`route.abort('connectionreset')`。
 * @param route - 当前拦截的网络请求。 */ route => route.abort('connectionreset')));
      pending.clear();
      await expect.poll(/** 重复读取`pending.size`，直到满足外层等待断言。 */ () => pending.size, { timeout: 20_000 }).toBe(2);
      assert.equal(ready, false, '恢复后的新请求完成前不能采样');
    }
    if (mode === 'persistent') {
      const rejected = assert.rejects(opening, /response=not-received reason=connection-failed/);
      await Promise.all([...pending.values()].map(/** 将当前条目映射为`route.abort('connectionreset')`。
 * @param route - 当前拦截的网络请求。 */ route => route.abort('connectionreset')));
      await rejected;
      assert.equal(ready, false, '持续中断不能继续采样');
      continue;
    }
    assert.equal(ready, false, '旧控件或未完成请求不能作为本次就绪依据');
    await pending.get(order[0])!.fulfill({ json: { ok: true, result: {} } });
    await expect(page.locator('#completed')).toHaveText('1');
    await expect(page.getByTestId('renew-popup-close-button')).toBeVisible();
    assert.equal(ready, false, '只返回一项读取时不能关闭或采样');
    await pending.get(order[1])!.fulfill({ json: { ok: true, result: {} } });
    await expect(page.locator('#completed')).toHaveText('2');
    await opening;
    if (mode === 'failover') assert.equal(await page.locator('body').getAttribute('data-opens'), '3');
    assert.equal(ready, true, '两项本次读取均成功后才允许采样');
    if (mode !== 'recover') assert.equal(await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now()), before, '准备读取不得推进动画相位');
    await press(page, 'renew-popup-close-button');
    await press(page, 'menu-button');
  }
});

test('续时读取的 HTTP 错误、业务拒绝和无效 JSON 均须立即阻止后续采样', /** 验证续时读取的 HTTP 错误、业务拒绝和无效 JSON 均须立即阻止后续采样。 */ async () => {
  for (const scenario of ['http', 'business', 'json', 'http-with-interruption']) {
    const mode = scenario === 'http-with-interruption' ? 'http' : scenario;
    const page = await browser.newPage();
    await page.route(`${origin}/**`, /** 按续时场景注入 HTTP 失败、中断或正常读取响应。
 * @param route - 当前拦截的网络请求。 */ route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: markup });
      if (scenario === 'http-with-interruption' && !path.endsWith('/price')) return route.abort('connectionreset');
      if (!path.endsWith('/price')) return route.fulfill({ json: { ok: true, result: {} } });
      assert.equal(route.request().method(), 'POST', '续时价格必须通过原始 POST 请求读取');
      if (mode === 'http') return route.fulfill({ status: 503, body: '不得传播的响应正文' });
      if (mode === 'business') return route.fulfill({ json: { ok: false, message: '不得传播的响应正文' } });
      return route.fulfill({ body: '不得传播的响应正文' });
    });
    await prepareRenewPage(page);
    let sampled = false;
    await assert.rejects(openRenewPopup(page).then(/** 标记续时弹层完成采样，检查失败场景不会提前通过。 */ () => { sampled = true; }), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
      assert.match(String(error), /续时数据准备失败：method=POST operation=renewal-price/);
      assert.match(String(error), mode.startsWith('http') ? /status=503/ : /status=200/);
      assert.doesNotMatch(String(error), /不得传播的响应正文|renewal\.invalid/);
      return true;
    });
    assert.equal(sampled, false, `${mode} 失败后不得继续采样`);
    assert.equal(await page.locator('body').getAttribute('data-opens'), '1', '响应错误不得重试');
    await page.close();
  }
});
