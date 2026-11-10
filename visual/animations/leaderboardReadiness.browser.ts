import { pauseReadinessClock, waitForStaleRead } from './readinessTestHelpers';
import { launchAnimationBrowser } from './appSessionBrowser';
/** 以离线浏览器请求验证个人排行榜准备的顺序和失败边界，不访问真实账号。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { expect, type Route } from '@playwright/test';
import { openPersonalLeaderboard } from './leaderboardReadiness';

const origin = 'https://leaderboard.invalid';
const roomId = 'fixture-room';
const self = 'fixture-user';
const markup = `<button data-testid="texas-holdem-leaderboard-button">个人排行榜</button>
  <output id="completed">0</output><script>
    document.querySelector('button').onclick = () => {
      document.querySelector('output').textContent = '0';
      for (const [path, method] of [['/v10/texas_holdem/room/fixture-room/player_statistics', 'PUT'], ['/v10/profile/fixture-user', 'GET']]) {
        fetch(path, {method}).then(response => response.text()).then(() => {
          const output = document.querySelector('output');
          output.textContent = String(Number(output.textContent) + 1);
        }).catch(() => {});
      }
    };
  </script>`;

test('每次打开个人排行榜面板均等待两项新读取，任一响应先到都不能提前采样', /** 验证每次打开个人排行榜面板均等待两项新读取，任一响应先到都不能提前采样。 */ async () => {
  const browser = await launchAnimationBrowser();
  try {
    const page = await browser.newPage();
    const pending = new Map<string, Route>();
    await page.route(`${origin}/**`, /** 提供排行榜测试页面，并按请求方法挂起数据读取。
 * @param route - 当前拦截的网络请求。 */ route => {
      if (new URL(route.request().url()).pathname === '/') return route.fulfill({ contentType: 'text/html', body: markup });
      pending.set(route.request().method(), route);
    });
    await page.goto(origin);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    const before = await page.evaluate(/** 记录排行榜就绪检查开始前的冻结时间。 */ () => Date.now());
    await page.evaluate(/** 发起旧的统计请求，验证它不会满足本次打开排行榜的等待。 */ () => {
      void fetch('/v10/texas_holdem/room/fixture-room/player_statistics', { method: 'PUT' }).then(/** 标记旧统计请求已结束，供本次请求归属断言使用。 */ () => {
        (window as typeof window & { staleReadFinished: boolean }).staleReadFinished = true;
      });
    });
    await expect.poll(/** 轮询旧排行榜请求是否挂起，确保迟到响应负例已准备好。 */ () => pending.has('PUT')).toBe(true);
    const stale = pending.get('PUT')!;
    for (const order of [['PUT', 'GET'], ['GET', 'PUT']]) {
      pending.clear();
      let ready = false;
      const opening = openPersonalLeaderboard(page, roomId, self).then(/** 标记排行榜本次打开操作已完成就绪等待。 */ () => { ready = true; });
      await expect.poll(/** 轮询本次打开产生的请求数，等待新的读取全部发出。 */ () => pending.size).toBe(2);
      if (order[0] === 'PUT') {
        await stale.fulfill({ json: { ok: true, result: {} } });
        await waitForStaleRead(page);
        assert.equal(ready, false, '本次打开前发出的旧请求即使成功也不能作为就绪依据');
      }
      assert.equal(ready, false, '旧控件或未完成请求不能作为本次就绪依据');
      await pending.get(order[0])!.fulfill({ json: { ok: true, result: {} } });
      await expect(page.locator('#completed')).toHaveText('1');
      assert.equal(ready, false, '只返回一项读取时不能关闭或采样');
      await pending.get(order[1])!.fulfill({ json: { ok: true, result: {} } });
      await opening;
      await expect(page.locator('#completed')).toHaveText('2');
      assert.equal(await page.evaluate(/** 读取排行榜等待结束后的时间，验证页面时钟未被推进。 */ () => Date.now()), before, '准备读取不得推进动画相位');
    }
  } finally { await browser.close(); }
});

test('个人排行榜读取的 HTTP 错误、业务拒绝、无效 JSON 和连接中断均须阻止后续采样', /** 验证个人排行榜读取的 HTTP 错误、业务拒绝、无效 JSON 和连接中断均须阻止后续采样。 */ async () => {
  const browser = await launchAnimationBrowser();
  try {
    for (const mode of ['http', 'business', 'json', 'abort']) {
      const page = await browser.newPage();
      await page.route(`${origin}/**`, /** 按路径控制排行榜请求的成功、失败与延迟，验证真实错误传播。
 * @param route - 当前拦截的网络请求。 */ route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/') return route.fulfill({ contentType: 'text/html', body: markup });
        if (!path.endsWith('/player_statistics')) return route.fulfill({ json: { ok: true, result: {} } });
      return failRead(route, mode);
      });
      await pauseReadinessClock(page, origin);
      let sampled = false;
      await assert.rejects(openPersonalLeaderboard(page, roomId, self).then(/** 标记排行榜已采样，排除未就绪时提前返回。 */ () => { sampled = true; }), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ error => {
        assert.match(String(error), /个人排行榜数据准备失败：method=PUT operation=leaderboard-statistics/);
        assert.match(String(error), mode === 'http' ? /status=503/ : mode === 'abort'
          ? /source=laiwan_proxy status=unavailable response=not-received/ : /status=200/);
        assert.doesNotMatch(String(error), /不得传播的响应正文|leaderboard\.invalid/);
        return true;
      });
      assert.equal(sampled, false, `${mode} 失败后不得继续采样`);
      await page.close();
    }
  } finally { await browser.close(); }
});

/**
 * 注入原有 HTTP 失败，其余模式交给业务与 JSON 场景。
 * @param route - 当前读取。
 * @param mode - 失败模式。
 * @returns 读取结果。
 */
function failRead(route: Route, mode: string): Promise<void> {
  if (mode === 'abort') return route.abort('connectionreset');
  return failHttpRead(route, mode);
}

/**
 * 保留 HTTP 失败的原始状态与正文。
 * @param route - 当前读取。
 * @param mode - 失败模式。
 * @returns 读取结果。
 */
function failHttpRead(route: Route, mode: string): Promise<void> {
  if (mode === 'http') return route.fulfill({ status: 503, body: '不得传播的响应正文' });
  return failBusinessRead(route, mode);
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
