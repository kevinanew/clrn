import type { Page } from '@playwright/test';

/**
 * 在独立取证页安装只读 React 提交观察器；不调用组件方法、回调或状态 setter。
 * @param page - 尚未导航的新页面。
 */
export async function installCardSpriteLifecycle(page: Page): Promise<void> {
  // 字符串脚本保持浏览器端独立序列化；不保存 props、资源地址、牌名或其他业务状态。
  await page.addInitScript(`(() => {
    const state = { status: 'awaiting-renderer', commits: 0, unmounts: 0, truncated: false };
    const ids = new WeakMap();
    let sequence = 0;
    const snapshots = new WeakMap();
    const roots = new Map();
    window.__clrnCardSpriteLifecycle = node => ({ ...state, component: snapshots.get(node) ?? null });
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) { state.status = 'existing-hook-unobserved'; return; }
    const identify = fiber => {
      if (!ids.has(fiber)) ids.set(fiber, ids.get(fiber.alternate) ?? ++sequence);
      return ids.get(fiber);
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        const key = this.renderers.size + 1;
        this.renderers.set(key, renderer);
        state.status = 'renderer-observed';
        return key;
      },
      onCommitFiberRoot(renderer, root) {
        try {
          state.commits++;
          const previous = roots.get(root) ?? new Set();
          const current = new Set();
          const pending = [root.current];
          let budget = 50000;
          while (pending.length && budget-- > 0) {
            const fiber = pending.pop();
            if (fiber.sibling) pending.push(fiber.sibling);
            if (fiber.child) pending.push(fiber.child);
            const node = fiber.stateNode;
            if (!(node instanceof Element) || !node.matches('[data-testid="sprite-image-container"]')) continue;
            let owner = fiber.return;
            let depth = 0;
            let matched = false;
            while (owner && depth++ < 30) {
              const props = owner.memoizedProps;
              if (props && props.data?.frames && 'source' in props && 'name' in props) { matched = true; break; }
              owner = owner.return;
            }
            const visible = owner?.memoizedState;
            const scaleX = visible?.next;
            const scaleY = scaleX?.next;
            const supported = matched && typeof visible?.memoizedState === 'boolean'
              && typeof scaleX?.memoizedState === 'number' && Number.isFinite(scaleX.memoizedState)
              && typeof scaleY?.memoizedState === 'number' && Number.isFinite(scaleY.memoizedState);
            snapshots.set(node, { id: matched ? identify(owner) : null, commit: state.commits,
              mounted: true, supported,
              visible: supported ? visible.memoizedState : null,
              scaleX: supported ? scaleX.memoizedState : null,
              scaleY: supported ? scaleY.memoizedState : null });
            current.add(node);
          }
          if (pending.length) state.truncated = true;
          for (const node of previous) {
            if (current.has(node)) continue;
            snapshots.set(node, { ...snapshots.get(node), mounted: false, commit: state.commits });
            state.unmounts++;
          }
          roots.set(root, current);
          window.__clrnSampleCardSprites?.('react-commit')?.catch(() => {});
        } catch { state.status = 'unsupported-fiber-shape'; }
      },
      onCommitFiberUnmount() {},
    };
  })();`);
}
