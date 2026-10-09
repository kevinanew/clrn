import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { BrowserContext } from '@playwright/test';
import { disableAnimations, fixNavigatorLanguage } from './pageSetup';

/**
 * 捕获上下文初始化脚本并序列化，用于验证浏览器执行不依赖外部编译辅助函数。
 * @param setup - 向浏览器上下文注册初始化脚本的函数。
 */
async function serializedScript(setup: (context: BrowserContext) => Promise<void>): Promise<string> {
  let source = '';
  await setup({
    /**
     * 捕获注册的浏览器初始化脚本，供单元测试序列化执行。
     * @param script - 待注册的浏览器初始化脚本或函数。
     */
    addInitScript: async (script: string | (() => void)) => {
    source = typeof script === 'string' ? script : `(${script.toString()})()`;
  } } as unknown as BrowserContext);
  return source;
}

test('tsx auth collector language script runs without external compiler helpers', async () => {
  /** 提供独立的 Navigator 原型，验证语言修正脚本不会修改宿主环境。 */
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
    head: {
      /**
       * 在测试 DOM 中登记插入的样式节点。
       * @param style - 由初始化脚本创建的样式节点。
       */
      appendChild: (style: typeof styles[number]) => styles.push(style) },
    /**
     * 在测试 DOM 中按 ID 查找已插入的样式节点。
     * @param id - 目标控件的测试标记。
     */
    getElementById: (id: string) => styles.find(style => style.id === id),
    /** 创建用于动画禁用测试的空样式节点。 */
    createElement: () => ({ id: '', textContent: '' }),
    /**
     * 记录 DOM 就绪回调，供测试手动触发第二次样式注入。
     * @param event - 要监听的 DOM 事件名称。
     * @param listener - 事件发生时执行的回调。
     */
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
