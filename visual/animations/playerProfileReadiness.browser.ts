import { pauseReadinessClock, waitForStaleRead } from './readinessTestHelpers';
import { launchAnimationBrowser } from './appSessionBrowser';
/** 验证玩家资料采样必须等本次三项读取完成，使用离线页面和受控响应。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { expect, type Route, type Page } from '@playwright/test';
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

test('每次打开玩家资料都等待本次三项成功读取，旧响应和部分数据不能提前采样', /** 验证每次打开玩家资料都等待本次三项成功读取，旧响应和部分数据不能提前采样。 */ async () => {
  const browser = await launchAnimationBrowser();
  try {
    const page = await browser.newPage();
    const pending = new Map<string, Route>();
    await page.route(`${origin}/**`, /** 提供玩家资料测试页面，并按路径挂起真实读取。
 * @param route - 当前拦截的网络请求。 */ route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: markup });
      pending.set(path, route);
    });
    await page.goto(origin);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const before = await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now());
    await page.evaluate(/** 发起本次操作之前的资料请求，验证请求归属判断。
 * @param path - 当前操作使用的 path。 */ path => { void fetch(path).then(/** 标记旧资料请求已结束，供后续就绪断言使用。 */ () => {
      (window as typeof window & { staleReadFinished: boolean }).staleReadFinished = true;
    }); }, paths[0]);
    await expect.poll(/** 重复读取`pending.has(paths[0])`，直到满足外层等待断言。 */ () => pending.has(paths[0])).toBe(true);
    const stale = pending.get(paths[0])!;
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
      pending.clear();
      let ready = false;
      const opening = openPlayerProfile(page, player).then(/** 标记本次玩家资料打开操作已通过就绪检查。 */ () => { ready = true; });
      await expect.poll(/** 重复读取`pending.size`，直到满足外层等待断言。 */ () => pending.size).toBe(3);
      await releaseStaleProfile(page, stale, order, /** 读取异步操作的最新完成状态。 */ () => ready);
      for (const [index, selected] of order.entries()) {
        assert.equal(ready, false, '资料、钱包和统计必须全部读取成功');
        await pending.get(paths[selected])!.fulfill({ json: { ok: true, result: {} } });
        await expect(page.locator('output')).toHaveText(String(index + 1));
      }
      await opening;
      assert.equal(await page.evaluate(/** 在页面中读取`Date.now()`，供测试判断当前界面状态。 */ () => Date.now()), before, '准备读取不得推进动画相位');
    }
  } finally { await browser.close(); }
});

test('玩家资料任一读取失败都阻止采样并保留真实状态，错误正文不得进入诊断', /** 验证玩家资料任一读取失败都阻止采样并保留真实状态，错误正文不得进入诊断。 */ async () => {
  const browser = await launchAnimationBrowser();
  try {
    for (const [index, operation] of ['player-profile', 'player-wallet', 'player-statistics'].entries()) {
      for (const mode of ['http', 'business', 'json']) {
        const page = await browser.newPage();
        await page.route(`${origin}/**`, /** 按预设路径注入玩家资料响应失败，其余接口正常返回。
 * @param route - 当前拦截的网络请求。 */ route => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/') return route.fulfill({ contentType: 'text/html', body: markup });
          if (path !== paths[index]) return route.fulfill({ json: { ok: true, result: {} } });
      return failRead(route, mode);
        });
        await pauseReadinessClock(page, origin);
        await assert.rejects(openPlayerProfile(page, player), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
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

/**
 * 旧资料响应只在首个顺序返回，确认它不能让本次读取提前完成。
 * @param page - 玩家资料页面。
 * @param stale - 旧资料请求。
 * @param order - 当前响应顺序。
 * @param ready - 本次打开是否完成。
 */
async function releaseStaleProfile(page: Page, stale: Route, order: number[], ready: () => boolean): Promise<void> {
      if (order[0] === 0) {
        await stale.fulfill({ json: { ok: true, result: {} } });
        await waitForStaleRead(page);
        assert.equal(ready(), false, '打开前发出的旧请求不能作为本次就绪依据');
      }
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
