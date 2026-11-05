import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { cardSpriteImageStateSource } from './cardSpriteImageState';

/** 独立协议夹具，仅代表 Image fiber 读取规则，不代表真实牌局。 */
class ImageNode {
  isConnected = true;
  /**
   * 返回本例的匿名图集容器。
   * @param _selector - 原生浏览器中的固定容器选择器。
   */
  closest(_selector: string) { return this; }
}

/** 在 VM 中执行实际浏览器脚本，不使用编译器助手或真实组件回调。 */
function observer() {
  const sandbox = { Element: ImageNode, state: { commits: 1 },
    /** 夹具的匿名身份。 */ identify: () => 11 };
  return runInNewContext(cardSpriteImageStateSource + '\n({ observeImageOwner, readImageOwner });', sandbox);
}

/**
 * 创建原固定版本的已提交 Image hooks 链，含会变化的 requestRef。
 * @param imageState - 受支持的 Image 内部枚举。
 */
function imageOwner(imageState = 'LOADING') {
  /** 不允许观察器调用组件状态更新。 */
  const dispatch = () => { throw new Error('observer called state setter'); };
  const request = { current: 17 as number | null };
  const values = [imageState, {}, { current: new ImageNode() }, { current: 9 }, request,
    { deps: ['fixture-private-resource', request, dispatch, undefined, dispatch, undefined, undefined] }];
  let next: any = null;
  for (const memoizedState of values.reverse()) next = { memoizedState, next };
  next.queue = { dispatch };
  return { request, fiber: { memoizedState: next, memoizedProps: { testID: 'sprite-image-view',
    source: 'https://probe.example.invalid/fixture-secret', onLoad: dispatch } } };
}

test('将同一牌面关联到实际加载器请求，读取 effect 后变化的 ref，不调用 setter 或保存私有值', /** 验证将同一牌面关联到实际加载器请求，读取 effect 后变化的 ref，不调用 setter 或保存私有值。 */ () => {
  const tracker = observer();
  const node = new ImageNode();
  const owner = imageOwner();
  assert.equal(tracker.readImageOwner(node).status, 'unobserved');
  tracker.observeImageOwner(node, { return: owner.fiber });
  const snapshot = tracker.readImageOwner(node);
  assert.equal(snapshot.status, 'supported');
  assert.equal(snapshot.state, 'LOADING');
  assert.equal(snapshot.request, 17);
  assert.equal(snapshot.id, 11);
  owner.request.current = 18;
  assert.equal(tracker.readImageOwner(node).request, 18, 'requestRef 在被动 effect 中更新，不能把提交时的旧值冒充当前请求');
  owner.request.current = null;
  assert.equal(tracker.readImageOwner(node).request, null, '清理后必须反映已取消请求');
  node.isConnected = false;
  assert.equal(tracker.readImageOwner(node).mounted, false);
  assert.doesNotMatch(JSON.stringify(tracker.readImageOwner(node)), /private|secret|example|source|onLoad|dispatch/);
});

test('未知 hook 结构与枚举明确失败，不把任意 hook 值解释为 Image 状态', /** 验证未知 hook 结构与枚举明确失败，不把任意 hook 值解释为 Image 状态。 */ () => {
  const tracker = observer();
  const node = new ImageNode();
  const owner = imageOwner('fixture-private-state');
  tracker.observeImageOwner(node, { return: owner.fiber });
  assert.equal(tracker.readImageOwner(node).status, 'unsupported');
  assert.equal(tracker.readImageOwner(node).state, null);
  const known = imageOwner('LOADED');
  known.request.current = -1;
  tracker.observeImageOwner(node, { return: known.fiber });
  assert.equal(tracker.readImageOwner(node).status, 'unsupported');
  known.request.current = 18;
  known.fiber.memoizedState.next = null;
  tracker.observeImageOwner(node, { return: known.fiber });
  assert.equal(tracker.readImageOwner(node).status, 'unsupported');
  assert.doesNotMatch(JSON.stringify(tracker.readImageOwner(node)), /private|secret|example/);
});
