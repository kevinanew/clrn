/** 验证玩家资料采样必须等本次三项读取完成，使用离线页面和受控响应。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect, type Route } from '@playwright/test';
import { openPlayerProfile } from './playerProfileReadiness';

const origin = 'https://player-profile.invalid';
const player = 'fixture-player';
const paths = [`/v10/profile/${player}`, `/v10/wallet/${player}/currency/coin`,
  `/v1/texas_statistics/player/${player}/rounds/100`];
const markup = `<button data-testid="texas-holdem-player-container-${player}">玩家资料</button>
  <output>0</output><script>
    document.querySelector('button').onclick = () => {
      document.querySelector('output').textContent = '0';
      for (const path of ${JSON.stringify(paths)}) {
        fetch(path).then(response => response.json()).then(() => {
          const output = document.querySelector('output');
          output.textContent = String(Number(output.textContent) + 1);
        }).catch(() => {});
      }
    };
  </script>`;

test('每次打开玩家资料都等待本次三项成功读取，旧响应和部分数据不能提前采样', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const pending = new Map<string, Route>();
    await page.route(`${origin}/**`, route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: markup });
      pending.set(path, route);
    });
    await page.goto(origin);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const before = await page.evaluate(() => Date.now());
    await page.evaluate(path => { void fetch(path).then(() => {
      (window as typeof window & { staleReadFinished: boolean }).staleReadFinished = true;
    }); }, paths[0]);
    await expect.poll(() => pending.has(paths[0])).toBe(true);
    const stale = pending.get(paths[0])!;
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
      pending.clear();
      let ready = false;
      const opening = openPlayerProfile(page, player).then(() => { ready = true; });
      await expect.poll(() => pending.size).toBe(3);
      if (order[0] === 0) {
        await stale.fulfill({ json: { ok: true, result: {} } });
        await expect.poll(() => page.evaluate(() =>
          (window as typeof window & { staleReadFinished?: boolean }).staleReadFinished)).toBe(true);
        assert.equal(ready, false, '打开前发出的旧请求不能作为本次就绪依据');
      }
      for (const [index, selected] of order.entries()) {
        assert.equal(ready, false, '资料、钱包和统计必须全部读取成功');
        await pending.get(paths[selected])!.fulfill({ json: { ok: true, result: {} } });
        await expect(page.locator('output')).toHaveText(String(index + 1));
      }
      await opening;
      assert.equal(await page.evaluate(() => Date.now()), before, '准备读取不得推进动画相位');
    }
  } finally { await browser.close(); }
});

test('玩家资料任一读取失败都阻止采样并保留真实状态，错误正文不得进入诊断', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    for (const [index, operation] of ['player-profile', 'player-wallet', 'player-statistics'].entries()) {
      for (const mode of ['http', 'business', 'json']) {
        const page = await browser.newPage();
        await page.route(`${origin}/**`, route => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/') return route.fulfill({ contentType: 'text/html', body: markup });
          if (path !== paths[index]) return route.fulfill({ json: { ok: true, result: {} } });
          if (mode === 'http') return route.fulfill({ status: 503, body: '不得传播的响应正文' });
          if (mode === 'business') return route.fulfill({ json: { ok: false, message: '不得传播的响应正文' } });
          return route.fulfill({ body: '不得传播的响应正文' });
        });
        await page.goto(origin);
        await page.clock.install();
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
        await assert.rejects(openPlayerProfile(page, player), error => {
          assert.match(String(error), new RegExp(`玩家资料准备失败：method=GET operation=${operation}`));
          assert.match(String(error), mode === 'http' ? /status=503/ : /status=200/);
          assert.doesNotMatch(String(error), /不得传播的响应正文|player-profile\.invalid/);
          return true;
        });
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
