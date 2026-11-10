import { waitForStaleRead } from './readinessTestHelpers';
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
    await runRenewMode(page, pending, mode, stale, before);
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
      if (!path.endsWith('/price')) return renewWalletResponse(route, scenario, path);
      assert.equal(route.request().method(), 'POST', '续时价格必须通过原始 POST 请求读取');
      return failRead(route, mode);
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

/**
 * 业务拒绝与中断同时发生时仍保留原来的失败优先级。
 * @param route - 钱包请求。
 * @param scenario - 错误组合场景。
 * @param path - 本次读取路径。
 * @returns 钱包完成或中断结果。
 */
function renewWalletResponse(route: Route, scenario: string, path: string): Promise<void> {
  if (scenario === 'http-with-interruption' && !path.endsWith('/price')) return route.abort('connectionreset');
  return completeRenewWallet(route, path);
}

/**
 * 在共享页面按原顺序执行每种恢复模式。
 * @param page - 续时页面。
 * @param pending - 本轮挂起请求。
 * @param mode - 恢复模式。
 * @param stale - 打开之前的旧价格请求。
 * @param before - 固定动画时间。
 */
async function runRenewMode(page: Page, pending: Map<string, Route>, mode: string, stale: Route, before: number): Promise<void> {
  pending.clear();
  let ready = false;
  const opening = openRenewPopup(page).then(/** 标记续时弹层已等待本次价格与钱包读取完成。 */ () => { ready = true; });
  await expect.poll(/** 重复读取`pending.size`，直到满足外层等待断言。 */ () => pending.size).toBe(2);
  const state = { /** 读取当前打开是否已完成。 */ ready: () => ready };
  await prepareRenewMode(page, pending, mode, stale, state.ready);
  if (mode === 'persistent') {
    await rejectPersistentRenew(pending, opening, state.ready);
    return;
  }
  await completeRenewMode(page, pending, mode, before, opening, state.ready);
}

/**
 * 根据固定场景表注入旧响应、节点重发或一次入口恢复。
 * @param page - 续时页面。
 * @param pending - 本轮请求。
 * @param mode - 恢复模式。
 * @param stale - 旧价格请求。
 * @param ready - 当前打开是否完成。
 */
async function prepareRenewMode(page: Page, pending: Map<string, Route>, mode: string, stale: Route, ready: () => boolean): Promise<void> {
  const actions: Record<string, () => Promise<void>> = {
    /** 核对旧请求不能满足当前等待。 */ 'post-first': () => releaseStaleRenew(page, stale, ready),
    /** 无旧响应干扰的反向完成顺序。 */ 'put-first': async () => {},
    /** 模拟应用自己在新节点重发。 */ failover: () => failoverRenew(page, pending),
    /** 验证一次入口恢复。 */ recover: () => recoverRenew(pending, ready),
    /** 验证恢复后持续失败。 */ persistent: () => recoverRenew(pending, ready),
  };
  await actions[mode]();
}

/**
 * 返回旧价格请求，确认新面板仍未就绪。
 * @param page - 续时页面。
 * @param stale - 旧请求。
 * @param ready - 本次打开的完成状态。
 */
async function releaseStaleRenew(page: Page, stale: Route, ready: () => boolean): Promise<void> {
  await stale.fulfill({ json: { ok: true, result: {} } });
  await waitForStaleRead(page);
  await expect(page.locator('#completed')).toHaveText('0');
  assert.equal(ready(), false, '本次打开前发出的旧请求即使成功也不能作为就绪依据');
}

/**
 * 中断当前两项读取。
 * @param pending - 本轮挂起的读取。
 */
async function abortRenewReads(pending: Map<string, Route>): Promise<void> {
  await Promise.all([...pending.values()].map(/** 中断真实网络读取。
   * @param route - 当前路由。 */ route => route.abort('connectionreset')));
}

/**
 * 原页面选线重发必须继续等两项真实读取，不重开面板。
 * @param page - 续时页面。
 * @param pending - 本轮请求。
 */
async function failoverRenew(page: Page, pending: Map<string, Route>): Promise<void> {
  await abortRenewReads(pending);
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

/**
 * 等待入口的一次恢复，并确认新请求完成前不能采样。
 * @param pending - 本轮请求。
 * @param ready - 当前打开是否完成。
 */
async function recoverRenew(pending: Map<string, Route>, ready: () => boolean): Promise<void> {
  await abortRenewReads(pending);
  pending.clear();
  await expect.poll(/** 重复读取`pending.size`，直到满足外层等待断言。 */ () => pending.size, { timeout: 20_000 }).toBe(2);
  assert.equal(ready(), false, '恢复后的新请求完成前不能采样');
}

/**
 * 恢复后的持续中断必须传播原失败。
 * @param pending - 恢复后的请求。
 * @param opening - 当前打开任务。
 * @param ready - 当前完成状态。
 */
async function rejectPersistentRenew(pending: Map<string, Route>, opening: Promise<void>, ready: () => boolean): Promise<void> {
  const rejected = assert.rejects(opening, /response=not-received reason=connection-failed/);
  await abortRenewReads(pending);
  await rejected;
  assert.equal(ready(), false, '持续中断不能继续采样');
}

/**
 * 按指定顺序返回两项本次读取，检查未完成、完成和关闭边界。
 * @param page - 续时页面。
 * @param pending - 本次请求。
 * @param mode - 完成顺序和恢复模式。
 * @param before - 原动画时间。
 * @param opening - 当前打开任务。
 * @param ready - 当前完成状态。
 */
async function completeRenewMode(page: Page, pending: Map<string, Route>, mode: string, before: number,
  opening: Promise<void>, ready: () => boolean): Promise<void> {
  const order = mode === 'put-first' ? ['PUT', 'POST'] : ['POST', 'PUT'];
  assert.equal(ready(), false, '旧控件或未完成请求不能作为本次就绪依据');
  await pending.get(order[0])!.fulfill({ json: { ok: true, result: {} } });
  await expect(page.locator('#completed')).toHaveText('1');
  await expect(page.getByTestId('renew-popup-close-button')).toBeVisible();
  assert.equal(ready(), false, '只返回一项读取时不能关闭或采样');
  await pending.get(order[1])!.fulfill({ json: { ok: true, result: {} } });
  await expect(page.locator('#completed')).toHaveText('2');
  await opening;
  if (mode === 'failover') assert.equal(await page.locator('body').getAttribute('data-opens'), '3');
  assert.equal(ready(), true, '两项本次读取均成功后才允许采样');
  await assertRenewPhase(page, mode, before);
  await press(page, 'renew-popup-close-button');
  await press(page, 'menu-button');
}

/**
 * 仅允许原有恢复流程的动画推进，其余准备保持同一相位。
 * @param page - 续时页面。
 * @param mode - 当前模式。
 * @param before - 准备前时间。
 */
async function assertRenewPhase(page: Page, mode: string, before: number): Promise<void> {
  if (mode !== 'recover') assert.equal(await page.evaluate(/** 读取固定时间。 */ () => Date.now()), before, '准备读取不得推进动画相位');
}

/**
 * 注入原有 HTTP 失败，其余模式交给业务与 JSON 场景。
 * @param route - 当前读取。
 * @param mode - 失败模式。
 * @returns 读取结果。
 */
function failRead(route: Route, mode: string): Promise<void> {
  if (mode === 'http') return route.fulfill({ status: 503, body: '不得传播的响应正文' });
  return failBusinessRead(route, mode);
}

/**
 * 非价格读取保持原钱包成功响应。
 * @param route - 钱包路由。
 * @param path - 当前路径。
 * @returns 读取结果。
 */
function completeRenewWallet(route: Route, path: string): Promise<void> {
  if (!path.endsWith('/price')) return route.fulfill({ json: { ok: true, result: {} } });
  throw new Error('钱包夹具不应处理价格读取');
}

/**
 * 注入原有业务拒绝或不可解析正文。
 * @param route - 当前读取。
 * @param mode - 失败模式。
 * @returns 读取结果。
 */
function failBusinessRead(route: Route, mode: string): Promise<void> {
  if (mode === 'business') return route.fulfill({ json: { ok: false, message: '不得传播的响应正文' } });
  return route.fulfill({ body: '不得传播的响应正文' });
}
