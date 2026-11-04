import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { cardSpriteClockState } from './cardSpriteClockState';

test('时钟现场只读保留嵌套零延时、动画帧和周期回调，回调源码不进入报告', async () => {
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    assert.deepEqual(await cardSpriteClockState(page), { status: 'not-installed' });
    await page.evaluate(() => { Object.assign(window, { __pwClock: { controller: {} } }); });
    assert.deepEqual(await cardSpriteClockState(page), { status: 'unsupported' });
    await page.evaluate(() => {
      const controller = { _now: { time: 0, ticks: 0 }, _timers: new Map([[1, {
        type: 'Timeout', delay: 0, callAt: 0, createdAt: 0,
        func: { /** 不支持的回调对象不能被取证器转换成字符串。 */ toString() { throw new Error('fixture-private-secret'); } },
      }]]) };
      Object.assign(window, { __pwClock: { controller } });
    });
    assert.deepEqual(await cardSpriteClockState(page), { status: 'unsupported' });
    await page.evaluate(() => { delete (window as typeof window & { __pwClock?: unknown }).__pwClock; });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.evaluate(() => {
      const state = window as typeof window & { nestedCallback?: string };
      setTimeout(() => {
        setTimeout(() => { state.nestedCallback = 'fixture-private-secret'; }, 0);
      }, 0);
      setInterval(() => {}, 80);
      requestAnimationFrame(() => {});
    });
    await page.clock.runFor(0);
    const frozen = await cardSpriteClockState(page);
    assert.equal(frozen.status, 'observed');
    if (frozen.status !== 'observed') throw new Error('固定 Playwright 版本必须支持时钟取证');
    assert.equal(frozen.running, false);
    assert.equal(frozen.virtualTime, Date.parse('2026-01-01T00:00:01Z'));
    assert.ok(frozen.timers.some(timer => timer.type === 'Timeout' && timer.delay === 0 && timer.remaining === 1));
    assert.ok(frozen.timers.some(timer => timer.type === 'Interval' && timer.remaining === 80));
    assert.ok(frozen.timers.some(timer => timer.type === 'AnimationFrame' && timer.remaining > 0));
    assert.doesNotMatch(JSON.stringify(frozen), /fixture-private-secret|setTimeout|nestedCallback/);
    assert.ok(frozen.timers.every(timer => /^callback-[a-f0-9]{16}$/.test(timer.callback)));
    await page.clock.runFor(0);
    assert.deepEqual(await cardSpriteClockState(page), frozen, '重复取证与 runFor(0) 都不能推进未来计时器');
    assert.equal(await page.evaluate(() => (window as typeof window & { nestedCallback?: string }).nestedCallback), undefined);
    await page.clock.runFor(1);
    assert.equal(await page.evaluate(() => (window as typeof window & { nestedCallback?: string }).nestedCallback), 'fixture-private-secret');
    await page.clock.resume();
    const running = await cardSpriteClockState(page);
    assert.ok(running.status === 'observed' && running.running);
    await page.close();
    assert.deepEqual(await cardSpriteClockState(page), { status: 'unavailable' });
  } finally { await browser.close(); }
});
