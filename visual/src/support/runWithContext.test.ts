import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BrowserContext } from '@playwright/test';
import { runWithContext } from './runWithContext';

describe('runWithContext', /** 核对浏览器上下文与异步任务的关闭顺序。 */ () => {
  test('waits for the task result before closing the context', /** 验证上下文会等任务结果读取完成后再关闭。 */ async () => {
    const events: string[] = [];
    let finishRead: ((value: Record<string, string>) => void) | undefined;
    const readEntries = new Promise<Record<string, string>>(/** 保存读取完成回调，使测试可以控制认证缓存的异步读取顺序。
 * @param resolve - 完成当前异步等待的通知。 */ (resolve) => {
      finishRead = resolve;
    });
    const context = {
      /** 关闭本机测试资源，供测试验证清理时机及错误传播。 */
      close: async () => {
        events.push('context closed');
      },
    } as BrowserContext;

    const resultPromise = runWithContext(context, /** 记录缓存读取开始和结束，验证上下文在读取完成前不会关闭。 */ async () => {
      events.push('read started');
      const entries = await readEntries;
      events.push('read finished');
      return entries;
    });

    await Promise.resolve();
    assert.deepEqual(events, ['read started']);
    finishRead?.({ token: 'refreshed' });

    assert.deepEqual(await resultPromise, { token: 'refreshed' });
    assert.deepEqual(events, ['read started', 'read finished', 'context closed']);
  });
});
