/**
 * 只读关联受支持 RN Web Image 的已提交 fiber 与当前 requestRef。
 * 嵌入 React 提交观察器作用域，共用匿名 identify 和提交编号 state。
 */
export const cardSpriteImageStateSource = `
    const imageOwners = new WeakMap();
    const observeImageOwner = (node, fiber) => {
      const container = node.closest('[data-testid="sprite-image-container"]');
      if (!container) return;
      let owner = fiber.return;
      let depth = 0;
      let matched = false;
      while (owner && depth++ < 30) {
        const props = owner.memoizedProps;
        if (props?.testID === 'sprite-image-view' && 'source' in props && typeof props.onLoad === 'function') {
          matched = true;
          break;
        }
        owner = owner.return;
      }
      if (!matched) owner = null;
      imageOwners.set(container, { owner, node, id: owner ? identify(owner) : null, commit: state.commits });
    };
    const readImageOwner = node => {
      const record = imageOwners.get(node);
      if (!record) return { status: 'unobserved' };
      const hooks = [];
      let hook = record.owner?.memoizedState;
      while (hook && hooks.length < 6) { hooks.push(hook); hook = hook.next; }
      const [image, layout, hidden, filter, request, effect] = hooks;
      const imageState = image?.memoizedState;
      const hiddenRef = hidden?.memoizedState;
      const requestRef = request?.memoizedState;
      const dependencies = effect?.memoizedState?.deps;
      const supported = ['IDLE', 'LOADING', 'LOADED', 'ERRORED'].includes(imageState)
        && layout?.memoizedState !== null && typeof layout?.memoizedState === 'object'
        && hiddenRef !== null && typeof hiddenRef === 'object' && 'current' in hiddenRef
        && (hiddenRef.current === null || hiddenRef.current instanceof Element)
        && Number.isFinite(filter?.memoizedState?.current)
        && requestRef !== null && typeof requestRef === 'object' && 'current' in requestRef
        && (requestRef.current === null || Number.isSafeInteger(requestRef.current) && requestRef.current > 0)
        && Array.isArray(dependencies) && dependencies.length === 7
        && typeof image.queue?.dispatch === 'function'
        && dependencies[1] === requestRef && dependencies[2] === image.queue?.dispatch;
      return { status: supported ? 'supported' : 'unsupported', id: record.id, commit: record.commit,
        mounted: node.isConnected && record.node.isConnected, state: supported ? imageState : null,
        request: supported ? requestRef.current : null };
    };
`;
