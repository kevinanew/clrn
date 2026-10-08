import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { BrowserContext } from '@playwright/test';
import { disableAnimations, fixNavigatorLanguage } from './pageSetup';

async function serializedScript(setup: (context: BrowserContext) => Promise<void>): Promise<string> {
  let source = '';
  await setup({ addInitScript: async (script: string | (() => void)) => {
    source = typeof script === 'string' ? script : `(${script.toString()})()`;
  } } as unknown as BrowserContext);
  return source;
}

test('tsx auth collector language script runs without external compiler helpers', async () => {
  class NavigatorMock {}
  Object.defineProperty(NavigatorMock.prototype, 'language', {
    value: 'en-US@posix', configurable: true,
  });
  runInNewContext(await serializedScript(fixNavigatorLanguage), { Navigator: NavigatorMock });
  const navigator = new NavigatorMock() as unknown as { language: string; languages: string[] };
  assert.equal(navigator.language, 'en-US');
  assert.deepEqual(Array.from(navigator.languages), ['en-US', 'en']);
});

test('tsx auth collector animation script installs one stylesheet before and after DOM ready', async () => {
  const styles: { id: string; textContent: string }[] = [];
  let onReady: (() => void) | undefined;
  const sandbox = { __VISUAL_REGRESSION__: false, document: {
    head: { appendChild: (style: typeof styles[number]) => styles.push(style) },
    getElementById: (id: string) => styles.find(style => style.id === id),
    createElement: () => ({ id: '', textContent: '' }),
    addEventListener: (event: string, listener: () => void) => {
      assert.equal(event, 'DOMContentLoaded');
      onReady = listener;
    },
  } };
  runInNewContext(await serializedScript(disableAnimations), sandbox);
  assert.equal(sandbox.__VISUAL_REGRESSION__, true);
  assert.equal(styles.length, 1);
  assert.match(styles[0].textContent, /animation: none/);
  assert.ok(onReady);
  onReady();
  assert.equal(styles.length, 1);
});
