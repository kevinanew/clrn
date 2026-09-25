import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BrowserContext } from '@playwright/test';
import { runWithContext } from './runWithContext';

describe('runWithContext', () => {
  test('waits for the task result before closing the context', async () => {
    const events: string[] = [];
    let finishRead: ((value: Record<string, string>) => void) | undefined;
    const readEntries = new Promise<Record<string, string>>((resolve) => {
      finishRead = resolve;
    });
    const context = {
      close: async () => {
        events.push('context closed');
      },
    } as BrowserContext;

    const resultPromise = runWithContext(context, async () => {
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
