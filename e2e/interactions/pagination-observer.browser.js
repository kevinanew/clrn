/** 只读采集真实分页输入与布局；由宿主读取源码以避免转译辅助函数进入浏览器。 */
(/** 安装有界只读观察器，返回显式清理接口。 */ () => {
  const screenId = 'game-buy-in-application-list-screen';
  const listId = 'game-buy-in-application-list';
  const records = [];
  const eventRecords = new WeakMap();
  let touchTarget = null;
  let dropped = 0;
  let frame = 0;
  let stopped = false;
  let sampling = false;
  let sampledFrames = 0;
  /**
   * 限制报告体积，保留超出数量而不无限占用内存。
   * @param value - 已筛选的诊断记录。
   */
  function append(value) {
    // 保留开头与末尾，超出上限时仍能保存触摸结束和断言结束的快照。
    if (records.length === 300) { records.splice(150, 1); dropped += 1; }
    records.push(value);
  }
  /**
   * 只允许固定测试标记与元素标签，不保存自由文本或动态标识。
   * @param element - 待描述的节点。
   */
  function identity(element) {
    if (!element) return { tag: null, marker: null };
    return { tag: element.tagName, marker: marker(element.getAttribute('data-testid')) };
  }
  /**
   * 读取矩形和手势相关样式，不复制元素或业务状态。
   * @param element - 待测量的节点。
   */
  function geometry(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { ...identity(element), x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      transform: style.transform, touchAction: style.touchAction, pointerEvents: style.pointerEvents,
      overflowX: style.overflowX, overflowY: style.overflowY, visibility: style.visibility,
      display: style.display, opacity: style.opacity };
  }
  /**
   * 记录导航页面、视窗、列表祖先变换和标签状态；不访问 React 内部状态。
   * @param phase - 测试提供的固定阶段名。
   */
  function snapshot(phase) {
    const screen = document.querySelector('[data-testid="' + screenId + '"]');
    const lists = Array.from(document.querySelectorAll('[data-testid="' + listId + '"]'));
    const layers = collectLayers(lists, screen);
    const tabs = screenTabs(screen);
    append({ kind: 'layout', phase, at: performance.now(), readyState: document.readyState,
      visibilityState: document.visibilityState,
      touchTarget: touchIdentity(touchTarget),
      viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio,
        ...visualViewportMetrics(window.visualViewport),
        maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer: coarse)').matches },
      screen: screen ? geometry(screen) : null,
      tabs: tabs.map(/** 只读取选中属性。
       * @param tab - 当前标签节点。
       */ tab => tab.getAttribute('aria-selected')),
      layers: Array.from(layers, geometry),
      busyCount: document.querySelectorAll('[aria-busy="true"]').length });
  }
  /** 每四帧采样一次，最多观察两百四十帧，不改变手势节奏或等待条件。 */
  function sample() {
    if (!canSample()) return;
    if (sampledFrames % 4 === 0) snapshot('动画帧');
    sampledFrames += 1;
    frame = requestAnimationFrame(sample);
  }
  /**
   * 观察浏览器实际分发事件；被动监听不会阻止默认行为或接管手势。
   * @param event - 浏览器输入事件。
   */
  function input(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (event.type === 'touchstart') touchTarget = target;
    const record = { kind: 'input', type: event.type, at: performance.now(), timestamp: event.timeStamp,
      trusted: event.isTrusted, cancelable: event.cancelable,
      defaultPreventedAtCapture: event.defaultPrevented, bubbledToDocument: false,
      target: identity(target), withinScreen: withinScreen(target),
      ...touchFields(event), ...pointerFields(event), hitPath: hitPath(event) };
    append(record);
    eventRecords.set(event, record);
  }
  /**
   * 分开记录冒泡阶段，未到达时不能把捕获阶段的值当作业务处理后的状态。
   * @param event - 到达文档冒泡阶段的事件。
   */
  function bubbled(event) {
    const record = eventRecords.get(event);
    if (record) {
      record.bubbledToDocument = true;
      record.defaultPreventedAtBubble = event.defaultPrevented;
    }
  }
  /**
   * 仅允许固定测试标记。
   * @param id - 元素测试标记。
   */
  function marker(id) { return [screenId, listId].includes(id) ? id : null; }
  /**
   * 保留最后触摸目标的连接状态。
   * @param target - 实际触摸目标。
   */
  function touchIdentity(target) { return target ? { ...identity(target), connected: target.isConnected } : null; }
  /**
   * 只读取当前页面标签。
   * @param screen - 当前页面节点。
   */
  function screenTabs(screen) { return screen ? Array.from(screen.querySelectorAll('[role="tab"]')) : []; }
  /**
   * 收集每个列表的至多八层祖先。
   * @param lists - 实际列表。
   * @param screen - 页面边界。
   */
  function collectLayers(lists, screen) {
    const layers = new Set();
    for (const list of lists) addLayers(layers, list, screen);
    return layers;
  }
  /**
   * 按既有顺序加入祖先，到页面边界停止。
   * @param layers - 祖先集合。
   * @param list - 起始列表。
   * @param screen - 页面边界。
   */
  function addLayers(layers, list, screen) {
    for (let node = list, depth = 0; node && depth < 8; node = parentLayer(node, screen), depth += 1) layers.add(node);
  }
  /**
   * 页面节点自身加入后不继续向上。
   * @param node - 当前层。
   * @param screen - 页面边界。
   */
  function parentLayer(node, screen) { return node === screen ? null : node.parentElement; }
  /**
   * 读取浏览器支持的视觉视口值；缺失字段在 JSON 中仍省略。
   * @param viewport - 当前视觉视口。
   */
  function visualViewportMetrics(viewport) {
    if (!viewport) return {};
    return { visualWidth: viewport.width, visualHeight: viewport.height, visualScale: viewport.scale,
      offsetLeft: viewport.offsetLeft, offsetTop: viewport.offsetTop };
  }
  /** 检查原有采样状态及两百四十帧上限。 */
  function canSample() { return [!stopped, sampling, sampledFrames < 240].every(Boolean); }
  /**
   * 仅检查目标是否归属固定页面。
   * @param target - 输入目标。
   */
  function withinScreen(target) { return Boolean(target?.closest('[data-testid="' + screenId + '"]')); }
  /**
   * 保留真实触点和活跃触点数。
   * @param event - 原始输入事件。
   */
  function touchFields(event) {
    if (!(event instanceof TouchEvent)) return { touches: null };
    return { touches: Array.from(event.changedTouches, touchPoint), activeTouches: event.touches.length };
  }
  /**
   * 只读取触点数值字段。
   * @param point - 当前触点。
   */
  function touchPoint(point) {
    return { id: point.identifier, x: point.clientX, y: point.clientY, pageX: point.pageX, pageY: point.pageY };
  }
  /**
   * 只读取真实鼠标数值字段。
   * @param event - 原始输入事件。
   */
  function pointerFields(event) {
    if (!(event instanceof MouseEvent)) return {};
    return { x: event.clientX, y: event.clientY, buttons: event.buttons };
  }
  /**
   * 只在输入开始时读取有限的命中路径。
   * @param event - 原始输入事件。
   */
  function hitPath(event) {
    if (!/^(touchstart|pointerdown|mousedown)$/.test(event.type)) return null;
    return event.composedPath().filter(/** 只保留元素，不保存文档或窗口。
     * @param node - 事件路径节点。 */ node => node instanceof Element).slice(0, 14).map(geometry);
  }
  const types = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove',
    'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup'];
  for (const type of types) {
    document.addEventListener(type, input, { capture: true, passive: true });
    document.addEventListener(type, bubbled, { passive: true });
  }
  return {
    snapshot,
    /** 开始记录手势和随后动画，不额外等待。 */
    begin() { snapshot('横滑前'); sampling = true; frame = requestAnimationFrame(sample); },
    /** 停止观察并移除所有监听；原业务异常仍由调用方抛出。 */
    finish() {
      snapshot('选中断言结束');
      stopped = true;
      cancelAnimationFrame(frame);
      for (const type of types) {
        document.removeEventListener(type, input, true);
        document.removeEventListener(type, bubbled);
      }
      return { version: 1, records, dropped };
    },
  };
})();
