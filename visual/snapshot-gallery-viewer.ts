// 内嵌到生成的 HTML，保证 file:// 打开时无需服务器或额外脚本。
export const viewerStyles = `
    #viewer { width: calc(100% - 32px); height: calc(100% - 32px); max-width: none; max-height: none; padding: 0; border: 1px solid #394454; border-radius: 12px; background: #111820; color: #f1f5f9; overflow: hidden; }
    #viewer::backdrop { background: rgb(8 13 20 / 85%); }
    .viewer-shell { display: flex; flex-direction: column; height: 100%; }
    .viewer-header { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #394454; }
    .viewer-heading { flex: 1; min-width: 0; }
    #viewer-title { font-size: 14px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #viewer-position { color: #b8c6d6; font-size: 12px; margin: 3px 0 0; }
    .viewer-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    #viewer button, #viewer a { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 8px 12px; border: 1px solid #526171; border-radius: 6px; background: #202c3a; color: #f1f5f9; font-size: 13px; text-decoration: none; }
    #viewer button:hover, #viewer a:hover { background: #334459; }
    #viewer button:disabled { opacity: .4; cursor: default; }
    #viewer button[aria-pressed="true"] { background: #1558a8; border-color: #78b8ff; }
    #viewer-zoom { min-width: 50px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
    #viewer-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: none; user-select: none; }
    #viewer-image { position: absolute; top: 50%; left: 50%; width: auto; max-width: none; max-height: none; object-fit: initial; background: none; transform-origin: center; pointer-events: none; }
    #viewer-stage[data-draggable="true"] { cursor: grab; }
    #viewer-stage[data-dragging="true"] { cursor: grabbing; }
    #viewer-message { position: absolute; inset: 0; display: grid; place-content: center; margin: 0; color: #b8c6d6; text-align: center; padding: 24px; }
    .viewer-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid #394454; }
    #viewer-meta, .viewer-help { font-size: 12px; color: #b8c6d6; margin: 0; }
    .viewer-help { margin-top: 3px; }
    @media (max-width: 760px) {
      #viewer { width: 100%; height: 100%; height: 100dvh; border: 0; border-radius: 0; }
      .viewer-header { padding: 8px; gap: 8px; }
      .viewer-heading { flex-basis: calc(100% - 72px); }
      .viewer-actions { order: 1; width: 100%; gap: 4px; justify-content: center; }
      #viewer button, #viewer a { padding: 8px; }
      .viewer-footer { padding: 8px; flex-wrap: wrap; gap: 6px; }
      .viewer-help { display: none; }
    }
`;

export const viewerMarkup = `
  <dialog id="viewer" aria-labelledby="viewer-title" aria-describedby="viewer-position">
    <div class="viewer-shell">
      <div class="viewer-header">
        <div class="viewer-heading">
          <h2 id="viewer-title"></h2>
          <p id="viewer-position" aria-live="polite"></p>
        </div>
        <div class="viewer-actions" role="group" aria-label="图片操作">
          <button id="viewer-prev" type="button" title="上一张（←）">上一张</button>
          <button id="viewer-next" type="button" title="下一张（→）">下一张</button>
          <button id="viewer-out" type="button" aria-label="缩小" title="缩小（-）">−</button>
          <span id="viewer-zoom" aria-live="polite">100%</span>
          <button id="viewer-in" type="button" aria-label="放大" title="放大（+）">+</button>
          <button id="viewer-fit" type="button" aria-pressed="true" title="完整显示图片（0）">适应窗口</button>
          <button id="viewer-actual" type="button" aria-pressed="false" title="按原始像素显示（1）">1:1</button>
        </div>
        <button id="viewer-close" type="button" title="关闭（Esc）" autofocus>关闭</button>
      </div>
      <div id="viewer-stage">
        <img id="viewer-image" alt="" draggable="false" hidden>
        <p id="viewer-message" aria-live="polite">正在加载图片…</p>
      </div>
      <div class="viewer-footer">
        <div>
          <p id="viewer-meta"></p>
          <p class="viewer-help">滚轮缩放 · 放大后拖动 · 双击切换原始大小 · ← → 切图 · Esc 关闭</p>
        </div>
        <div class="viewer-actions">
          <a id="viewer-original" target="_blank" rel="noopener">打开原图</a>
          <a id="viewer-download" download>下载</a>
        </div>
      </div>
    </div>
  </dialog>
`;

export const viewerScript = String.raw`
    const viewer = document.querySelector('#viewer');
    const stage = document.querySelector('#viewer-stage');
    const image = document.querySelector('#viewer-image');
    const message = document.querySelector('#viewer-message');
    const control = name => document.querySelector('#viewer-' + name);
    let items = [], current = 0, opener, previousOverflow;
    let scale = 1, fitScale = 1, offsetX = 0, offsetY = 0, mode = 'fit';
    const pointers = new Map();

    function setDisabled(name, disabled) {
      const button = control(name);
      const wasFocused = document.activeElement === button;
      button.disabled = disabled;
      if (disabled && wasFocused) control('close').focus();
    }

    function paint() {
      const maxX = Math.max(0, (image.naturalWidth * scale - stage.clientWidth) / 2 + 16);
      const maxY = Math.max(0, (image.naturalHeight * scale - stage.clientHeight) / 2 + 16);
      offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
      offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
      image.style.transform = 'translate(calc(-50% + ' + offsetX + 'px), calc(-50% + ' + offsetY + 'px)) scale(' + scale + ')';
      stage.dataset.draggable = String(maxX > 0 || maxY > 0);
      control('zoom').textContent = Math.round(scale * 100) + '%';
      control('fit').setAttribute('aria-pressed', String(mode === 'fit'));
      control('actual').setAttribute('aria-pressed', String(mode === 'actual'));
      setDisabled('out', image.hidden || scale <= Math.min(fitScale, 0.1));
      setDisabled('in', image.hidden || scale >= 4);
      setDisabled('fit', image.hidden);
      setDisabled('actual', image.hidden);
    }

    function measure() {
      fitScale = Math.min(1, Math.max(1, stage.clientWidth - 32) / image.naturalWidth,
        Math.max(1, stage.clientHeight - 32) / image.naturalHeight);
    }

    function reset(nextMode = 'fit') {
      if (image.hidden) return;
      measure();
      mode = nextMode;
      scale = mode === 'actual' ? 1 : fitScale;
      offsetX = offsetY = 0;
      paint();
    }

    function zoom(nextScale, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
      if (image.hidden) return;
      const before = scale;
      scale = Math.max(Math.min(fitScale, 0.1), Math.min(4, nextScale));
      offsetX = (offsetX - x + stage.clientWidth / 2) * scale / before + x - stage.clientWidth / 2;
      offsetY = (offsetY - y + stage.clientHeight / 2) * scale / before + y - stage.clientHeight / 2;
      mode = 'manual';
      paint();
    }

    function clearPointers() {
      pointers.forEach((_, id) => {
        if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
      });
      pointers.clear();
      stage.dataset.dragging = 'false';
    }

    function show(index) {
      current = index;
      clearPointers();
      const item = items[current];
      const card = item.closest('article');
      control('title').textContent = control('title').title = card.dataset.label;
      control('position').textContent = (current + 1) + ' / ' + items.length + ' · 当前筛选结果';
      control('meta').textContent = card.querySelector('.card-meta').textContent;
      control('original').href = control('download').href = item.href;
      setDisabled('prev', current === 0);
      setDisabled('next', current === items.length - 1);
      image.hidden = true;
      message.hidden = false;
      message.textContent = '正在加载图片…';
      image.alt = card.dataset.label + ' 页面截图';
      scale = 1;
      offsetX = offsetY = 0;
      mode = 'fit';
      paint();
      image.src = item.href;
    }

    image.addEventListener('load', () => {
      if (!viewer.open) return;
      image.hidden = false;
      message.hidden = true;
      reset();
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      message.hidden = false;
      message.textContent = '图片加载失败，请尝试打开原图，或切换到其他截图。';
      paint();
    });

    document.querySelectorAll('.snapshot-link').forEach(link => {
      link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        opener = link;
        items = Array.from(document.querySelectorAll('article:not([hidden]) .snapshot-link'));
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        viewer.showModal();
        show(items.indexOf(link));
      });
    });

    function navigate(delta) {
      const next = current + delta;
      if (next >= 0 && next < items.length) show(next);
    }
    control('prev').addEventListener('click', () => navigate(-1));
    control('next').addEventListener('click', () => navigate(1));
    control('in').addEventListener('click', () => zoom(scale * 1.25));
    control('out').addEventListener('click', () => zoom(scale / 1.25));
    control('fit').addEventListener('click', () => reset());
    control('actual').addEventListener('click', () => reset('actual'));
    control('close').addEventListener('click', () => viewer.close());
    viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
    viewer.addEventListener('close', () => {
      clearPointers();
      document.body.style.overflow = previousOverflow;
      opener?.focus({ preventScroll: true });
    });
    viewer.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Tab') {
        const focusable = Array.from(viewer.querySelectorAll('button:not([disabled]), a[href]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      const actions = {
        ArrowLeft: () => navigate(-1), ArrowRight: () => navigate(1),
        '+': () => zoom(scale * 1.25), '=': () => zoom(scale * 1.25),
        '-': () => zoom(scale / 1.25), '0': () => reset(), '1': () => reset('actual'),
      };
      if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
    });

    stage.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
      zoom(scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002),
        event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    stage.addEventListener('dblclick', () => reset(Math.abs(scale - 1) < 0.01 ? 'fit' : 'actual'));
    stage.addEventListener('pointerdown', event => {
      if (image.hidden || event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      stage.setPointerCapture(event.pointerId);
      stage.dataset.dragging = 'true';
    });
    stage.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      const before = Array.from(pointers.values());
      const last = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const after = Array.from(pointers.values());
      if (before.length === 2) {
        const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
        const start = midpoint(before), end = midpoint(after), rect = stage.getBoundingClientRect();
        if (distance(before) > 0) zoom(scale * distance(after) / distance(before), start.x - rect.left, start.y - rect.top);
        offsetX += end.x - start.x;
        offsetY += end.y - start.y;
      } else if (before.length === 1) {
        offsetX += event.clientX - last.x;
        offsetY += event.clientY - last.y;
      }
      paint();
    });
    function endPointer(event) {
      pointers.delete(event.pointerId);
      stage.dataset.dragging = String(pointers.size > 0);
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('lostpointercapture', endPointer);
    new ResizeObserver(() => {
      if (!viewer.open || image.hidden) return;
      measure();
      if (mode === 'fit') reset(); else paint();
    }).observe(stage);
`;
