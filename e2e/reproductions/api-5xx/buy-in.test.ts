/** 断言边界回归：空白提示和未处理异常必须失败，原始观测仍保留。 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Page } from '@playwright/test';
import { expectReadableError, withNoPageErrors } from './buy-in';

test('5xx 提示拒绝空白、undefined 和余额误报，接受实际中英文错误', /** 核对正确行为断言会拒绝原检查放过的空白提示。 */ () => {
  for (const message of [null, '', '   ', '\n\t', '\u00a0\u2003', '\u3000', 'undefined',
    '玩家筹码不足-sit', '余额不足', '籌碼不足', '餘額不足', 'Insufficient chips', 'Insufficient balance']) {
    assert.throws(/** 将候选错误交给场景实际使用的断言，不复制判定实现。 */ () => expectReadableError(message));
  }
  for (const message of ['Request failed with status code 500', '503 网络有点问题，请重试', '  服务器暂时不可用  ']) {
    assert.doesNotThrow(/** 可读服务器错误应保留其实际语言和内容。 */ () => expectReadableError(message));
  }
});

test('正常提示并不能掩盖 pageerror；故障及恢复阶段异常都会失败并解除监听', /** 用页面事件契约验证异步异常会改变最终结果，而非只检查订阅调用。 */ async () => {
  const events = new EventEmitter();
  const page = events as unknown as Pick<Page, 'on' | 'off'>;
  for (const phase of ['fault', 'retry', 'recovery']) {
    await assert.rejects(withNoPageErrors(page, /** 模拟本阶段既有正常错误提示又出现未处理异常。 */ async () => {
      expectReadableError('Request failed with status code 503');
      await Promise.resolve();
      events.emit('pageerror', new Error(`synthetic-private-pageerror-${phase}`));
    }), /** 只允许固定的异常数量诊断，不传播原始敏感异常。
     * @param error - 场景最终抛出的断言错误。 */ error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Expected: 0[\s\S]*Received: 1/);
      assert.ok(!error.message.includes('synthetic-private-pageerror'));
      return true;
    });
    assert.equal(events.listenerCount('pageerror'), 0);
  }
  await withNoPageErrors(page, /** 没有未处理异常时正常结束实验。 */ async () => {});
  const original = new Error('original assertion failed');
  await assert.rejects(withNoPageErrors(page, /** 既有场景失败仍须向上传播。 */ async () => { throw original; }), original);
  assert.equal(events.listenerCount('pageerror'), 0);
  let faultStarted = false;
  await assert.rejects(withNoPageErrors(page, /** 对照出现异常必须在任何故障注入之前结束。
   * @param check - 场景在正常对照后执行的实际检查。 */ async check => {
    events.emit('pageerror', new Error('synthetic control pageerror'));
    check();
    faultStarted = true;
  }));
  assert.equal(faultStarted, false);
  assert.equal(events.listenerCount('pageerror'), 0);
});
