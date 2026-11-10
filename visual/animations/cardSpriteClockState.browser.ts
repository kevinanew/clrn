import { launchAnimationBrowser } from './appSessionBrowser';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardSpriteClockState } from './cardSpriteClockState';

test('时钟现场只读保留嵌套零延时、动画帧和周期回调，回调源码不进入报告', /** 验证时钟现场只读保留嵌套零延时、动画帧和周期回调，回调源码不进入报告。 */ async () => {
  const browser = await launchAnimationBrowser();
  try {
    const page = await browser.newPage();
    assert.deepEqual(await cardSpriteClockState(page), { status: 'not-installed' });
    await page.evaluate(/** 注入不完整的 Playwright 时钟控制器，验证结构校验不会误判可用。 */ () => { Object.assign(window, { __pwClock: { controller: {} } }); });
    assert.deepEqual(await cardSpriteClockState(page), { status: 'unsupported' });
    await page.evaluate(/** 注入回调类型不受支持的计时器，验证取证器不会执行任意对象转换。 */ () => {
      const controller = { _now: { time: 0, ticks: 0 }, _timers: new Map([[1, {
        type: 'Timeout', delay: 0, callAt: 0, createdAt: 0,
        func: { /** 不支持的回调对象不能被取证器转换成字符串。 */ toString() { throw new Error('fixture-private-secret'); } },
      }]]) };
      Object.assign(window, { __pwClock: { controller } });
    });
    assert.deepEqual(await cardSpriteClockState(page), { status: 'unsupported' });
    await page.evaluate(/** 移除页面时钟控制器，构造时钟不可用场景。 */ () => { delete (window as typeof window & { __pwClock?: unknown }).__pwClock; });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.evaluate(/** 注册嵌套超时、周期计时与帧回调，验证时钟取证覆盖各类任务。 */ () => {
      const state = window as typeof window & { nestedCallback?: string };
      setTimeout(/** 注册下一层零延迟任务，复现嵌套计时器调度。 */ () => {
        setTimeout(/** 标记嵌套任务已执行，验证时钟推进与敏感回调脱敏。 */ () => { state.nestedCallback = 'fixture-private-secret'; }, 0);
      }, 0);
      setInterval(/** 保持周期计时器存在，供时钟队列取证使用。 */ () => {}, 80);
      requestAnimationFrame(/** 注册空帧任务，供动画帧计时器取证使用。 */ () => {});
    });
    await page.clock.runFor(0);
    const frozen = await cardSpriteClockState(page);
    assert.equal(frozen.status, 'observed');
    if (frozen.status !== 'observed') throw new Error('固定 Playwright 版本必须支持时钟取证');
    assert.equal(frozen.running, false);
    assert.equal(frozen.virtualTime, Date.parse('2026-01-01T00:00:01Z'));
    assert.ok(frozen.timers.some(/** 判断是否存在满足以下条件的条目：`timer.type === 'Timeout' && timer.delay === 0 && timer.remaining === 1`。
 * @param timer - 当前操作使用的 timer。 */ timer => timer.type === 'Timeout' && timer.delay === 0 && timer.remaining === 1));
    assert.ok(frozen.timers.some(/** 判断是否存在满足以下条件的条目：`timer.type === 'Interval' && timer.remaining === 80`。
 * @param timer - 当前操作使用的 timer。 */ timer => timer.type === 'Interval' && timer.remaining === 80));
    assert.ok(frozen.timers.some(/** 判断是否存在满足以下条件的条目：`timer.type === 'AnimationFrame' && timer.remaining > 0`。
 * @param timer - 当前操作使用的 timer。 */ timer => timer.type === 'AnimationFrame' && timer.remaining > 0));
    assert.doesNotMatch(JSON.stringify(frozen), /fixture-private-secret|setTimeout|nestedCallback/);
    assert.ok(frozen.timers.every(/** 确认所有条目均满足：`/^callback-[a-f0-9]{16}$/.test(timer.callback)`。
 * @param timer - 当前操作使用的 timer。 */ timer => /^callback-[a-f0-9]{16}$/.test(timer.callback)));
    await page.clock.runFor(0);
    assert.deepEqual(await cardSpriteClockState(page), frozen, '重复取证与 runFor(0) 都不能推进未来计时器');
    assert.equal(await page.evaluate(/** 在页面中读取`(window as typeof window & { nestedCallback?: string }).nestedCallback`，供测试判断当前界面状态。 */ () => (window as typeof window & { nestedCallback?: string }).nestedCallback), undefined);
    await page.clock.runFor(1);
    assert.equal(await page.evaluate(/** 在页面中读取`(window as typeof window & { nestedCallback?: string }).nestedCallback`，供测试判断当前界面状态。 */ () => (window as typeof window & { nestedCallback?: string }).nestedCallback), 'fixture-private-secret');
    await page.clock.resume();
    const running = await cardSpriteClockState(page);
    assert.ok(running.status === 'observed' && running.running);
    await page.close();
    assert.deepEqual(await cardSpriteClockState(page), { status: 'unavailable' });
  } finally { await browser.close(); }
});
