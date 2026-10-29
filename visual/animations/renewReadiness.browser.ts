/** 以离线浏览器请求验证续时准备的顺序和失败边界，不访问真实账号。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect, type Route } from '@playwright/test';
import { openRenewPopup } from './renewReadiness';

const origin = 'https://renewal.invalid';
const markup = `<button data-testid="drawer-menu-item-renew">续时</button>
  <output id="completed">0</output><script>
    document.querySelector('button').onclick = () => {
      document.querySelector('output').textContent = '0';
      for (const [path, method] of [['/v3/pay_action/batch/price', 'POST'], ['/v10/wallet/fixture-user', 'PUT']]) {
        fetch(path, {method}).then(response => response.text()).then(() => {
          const output = document.querySelector('output');
          output.textContent = String(Number(output.textContent) + 1);
        }).catch(() => {});
      }
    };
  </script>`;

test('每次打开续时面板均等待两项新读取，任一响应先到都不能提前采样', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const pending = new Map<string, Route>();
    await page.route(`${origin}/**`, route => {
      if (new URL(route.request().url()).pathname === '/') return route.fulfill({ contentType: 'text/html', body: markup });
      pending.set(route.request().method(), route);
    });
    await page.goto(origin);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const before = await page.evaluate(() => Date.now());
    await page.evaluate(() => {
      void fetch('/v3/pay_action/batch/price', { method: 'POST' }).then(() => {
        (window as typeof window & { staleReadFinished: boolean }).staleReadFinished = true;
      });
    });
    await expect.poll(() => pending.has('POST')).toBe(true);
    const stale = pending.get('POST')!;
    for (const order of [['POST', 'PUT'], ['PUT', 'POST']]) {
      pending.clear();
      let ready = false;
      const opening = openRenewPopup(page).then(() => { ready = true; });
      await expect.poll(() => pending.size).toBe(2);
      if (order[0] === 'POST') {
        await stale.fulfill({ json: { ok: true, result: {} } });
        await expect.poll(() => page.evaluate(() =>
          (window as typeof window & { staleReadFinished?: boolean }).staleReadFinished)).toBe(true);
        assert.equal(ready, false, '本次打开前发出的旧请求即使成功也不能作为就绪依据');
      }
      assert.equal(ready, false, '旧控件或未完成请求不能作为本次就绪依据');
      await pending.get(order[0])!.fulfill({ json: { ok: true, result: {} } });
      await expect(page.locator('#completed')).toHaveText('1');
      assert.equal(ready, false, '只返回一项读取时不能关闭或采样');
      await pending.get(order[1])!.fulfill({ json: { ok: true, result: {} } });
      await opening;
      await expect(page.locator('#completed')).toHaveText('2');
      assert.equal(await page.evaluate(() => Date.now()), before, '准备读取不得推进动画相位');
    }
  } finally { await browser.close(); }
});

test('续时读取的 HTTP 错误、业务拒绝、无效 JSON 和连接中断均须阻止后续采样', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    for (const mode of ['http', 'business', 'json', 'abort']) {
      const page = await browser.newPage();
      await page.route(`${origin}/**`, route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/') return route.fulfill({ contentType: 'text/html', body: markup });
        if (!path.endsWith('/price')) return route.fulfill({ json: { ok: true, result: {} } });
        if (mode === 'abort') return route.abort('connectionreset');
        if (mode === 'http') return route.fulfill({ status: 503, body: '不得传播的响应正文' });
        if (mode === 'business') return route.fulfill({ json: { ok: false, message: '不得传播的响应正文' } });
        return route.fulfill({ body: '不得传播的响应正文' });
      });
      await page.goto(origin);
      await page.clock.install();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      let sampled = false;
      await assert.rejects(openRenewPopup(page).then(() => { sampled = true; }), error => {
        assert.match(String(error), /续时数据准备失败：method=POST operation=renewal-price/);
        assert.match(String(error), mode === 'http' ? /status=503/ : mode === 'abort'
          ? /status=未收到响应/ : /status=200/);
        assert.doesNotMatch(String(error), /不得传播的响应正文|renewal\.invalid/);
        return true;
      });
      assert.equal(sampled, false, `${mode} 失败后不得继续采样`);
      await page.close();
    }
  } finally { await browser.close(); }
});
