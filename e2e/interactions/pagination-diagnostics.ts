import type { JSHandle, Page, TestInfo } from '@playwright/test';

type Observation = {
  snapshot: (phase: string) => void;
  begin: () => void;
  finish: () => { version: number; records: unknown[]; dropped: number };
};

/**
 * 观察分页手势的真实输入和布局；只记录数值与固定标记，不读取账号、正文、地址或存储。
 * @param page - 当前真实交互页面。
 */
export async function observePaginationGesture(page: Page) {
  // 浏览器代码使用字符串，避免本机 TypeScript 转译辅助函数进入页面。
  const observation = await page.evaluateHandle(`(() => {
    const screenId = 'game-buy-in-application-list-screen';
    const listId = 'game-buy-in-application-list';
    const records = [];
    const eventRecords = new WeakMap();
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
      const id = element?.getAttribute('data-testid');
      return { tag: element?.tagName ?? null, marker: id === screenId || id === listId ? id : null };
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
      const layers = new Set();
      for (const list of lists) {
        for (let node = list, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) {
          layers.add(node);
          if (node === screen) break;
        }
      }
      const tabs = screen ? Array.from(screen.querySelectorAll('[role="tab"]')) : [];
      const viewport = window.visualViewport;
      append({ kind: 'layout', phase, at: performance.now(), readyState: document.readyState,
        visibilityState: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio,
          visualWidth: viewport?.width, visualHeight: viewport?.height, visualScale: viewport?.scale,
          offsetLeft: viewport?.offsetLeft, offsetTop: viewport?.offsetTop,
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
      if (stopped || !sampling || sampledFrames >= 240) return;
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
      const touch = event instanceof TouchEvent ? event : null;
      const pointer = event instanceof MouseEvent ? event : null;
      const record = { kind: 'input', type: event.type, at: performance.now(), timestamp: event.timeStamp,
        trusted: event.isTrusted, cancelable: event.cancelable,
        defaultPreventedAtCapture: event.defaultPrevented, bubbledToDocument: false,
        target: identity(target), withinScreen: Boolean(target?.closest('[data-testid="' + screenId + '"]')),
        touches: touch ? Array.from(touch.changedTouches, /** 保存坐标与触点编号。
         * @param point - 当前变化的触点。
         */ point => ({ id: point.identifier, x: point.clientX, y: point.clientY,
          pageX: point.pageX, pageY: point.pageY })) : null,
        activeTouches: touch?.touches.length,
        x: pointer?.clientX, y: pointer?.clientY, buttons: pointer?.buttons,
        hitPath: /^(touchstart|pointerdown|mousedown)$/.test(event.type)
          ? event.composedPath().filter(node => node instanceof Element).slice(0, 14).map(geometry) : null };
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
  })()`) as JSHandle<Observation>;
  return {
    /**
     * 保存一次阶段快照。
     * @param phase - 不含业务数据的固定阶段名。
     */
    async mark(phase: string) { await observation.evaluate((observer, value) => observer.snapshot(value), phase); },
    /** 开始观察原始横滑，不改变输入参数。 */
    async begin() { await observation.evaluate(observer => observer.begin()); },
    /**
     * 将白名单诊断附到桌面或触屏报告，用于对照成功与失败的实际事件。
     * @param info - 当前用例报告。
     */
    async save(info: TestInfo) {
      try {
        const result = await observation.evaluate(observer => observer.finish());
        await info.attach('分页手势诊断', { body: JSON.stringify({ ...result,
          configured: { viewport: info.project.use.viewport, isMobile: info.project.use.isMobile,
            hasTouch: info.project.use.hasTouch, deviceScaleFactor: info.project.use.deviceScaleFactor } }),
        contentType: 'application/json' });
      } finally { await observation.dispose(); }
    },
  };
}
