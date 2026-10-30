import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { Page } from '@playwright/test';
import { installCardSpriteLifecycle } from './cardSpriteLifecycle';

/** 离线模拟 DOM 身份；这里只验证观察器协议，不代表真实 React 或应用回归。 */
class SpriteNode {
  /**
   * 当前节点代表唯一图集容器。
   * @param selector - 观察器查询的容器选择器。
   */
  matches(selector: string): boolean { return selector === '[data-testid="sprite-image-container"]'; }
}

/**
 * 在独立脚本环境执行实际注入代码。
 * @param existingHook - 模拟页面已存在其他开发工具观察器。
 */
async function observation(existingHook = false) {
  let script = '';
  const page = { /**
   * 捕获交给浏览器的完整脚本。
   * @param value - init 脚本源码。
   */ addInitScript: async (value: string) => { script = value; } } as unknown as Page;
  await installCardSpriteLifecycle(page);
  // VM 与浏览器相同地执行字符串，不依赖 tsx 的序列化辅助函数。
  const window = { ...(existingHook ? { __REACT_DEVTOOLS_GLOBAL_HOOK__: {} } : {}) } as Record<string, any>;
  runInNewContext(script, { window, Element: SpriteNode });
  return window;
}

test('提交观察关联同一组件与替换组件，不调用回调且不保存 props 或任意 hook 值', async () => {
  const window = await observation();
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  hook.inject({});
  const node = new SpriteNode();
  let callbackInvoked = false;
  const owner = { memoizedProps: { source: 'https://probe.example.invalid/token=fixture-secret',
    name: 'private-card', data: { frames: {} },
    /** 应用回调不得被取证器执行。 */ onLoad: () => { callbackInvoked = true; } },
    memoizedState: { memoizedState: false, next: { memoizedState: 0.5, next: { memoizedState: 0.6 } } } };
  const root = { current: { stateNode: node, return: owner } };
  hook.onCommitFiberRoot(1, root);
  const first = window.__clrnCardSpriteLifecycle(node);
  assert.equal(first.component.visible, false);
  assert.equal(first.component.supported, true);
  const next = { ...owner, alternate: owner,
    memoizedState: { ...owner.memoizedState, memoizedState: true } };
  root.current.return = next;
  hook.onCommitFiberRoot(1, root);
  assert.equal(window.__clrnCardSpriteLifecycle(node).component.id, first.component.id);
  assert.equal(window.__clrnCardSpriteLifecycle(node).component.visible, true);
  root.current.return = { ...owner };
  hook.onCommitFiberRoot(1, root);
  assert.notEqual(window.__clrnCardSpriteLifecycle(node).component.id, first.component.id);
  assert.doesNotMatch(JSON.stringify(window.__clrnCardSpriteLifecycle(node)), /example|secret|private-card/);
  root.current = {} as typeof root.current;
  hook.onCommitFiberRoot(1, root);
  assert.equal(window.__clrnCardSpriteLifecycle(node).component.mounted, false);
  assert.equal(window.__clrnCardSpriteLifecycle(node).unmounts, 1);
  assert.equal(callbackInvoked, false);
});

test('已有 hook 保持不变；不支持的组件结构明确标为未观察', async () => {
  const existing = await observation(true);
  assert.deepEqual(Object.keys(existing.__REACT_DEVTOOLS_GLOBAL_HOOK__), []);
  assert.equal(existing.__clrnCardSpriteLifecycle(new SpriteNode()).status, 'existing-hook-unobserved');
  const window = await observation();
  const node = new SpriteNode();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1,
    { current: { stateNode: node, return: { memoizedProps: {}, memoizedState: { memoizedState: 'fixture-secret' } } } });
  const report = window.__clrnCardSpriteLifecycle(node);
  assert.equal(report.component.supported, false);
  assert.equal(report.component.visible, null);
  assert.doesNotMatch(JSON.stringify(report), /fixture-secret/);
});
