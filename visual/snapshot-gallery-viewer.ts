// 内嵌到生成的 HTML，保证 file:// 打开时无需服务器或额外脚本。
export { viewerStyles, viewerMarkup } from './snapshot-gallery-viewer-ui';

export const viewerScript = String.raw`
    const viewer = document.querySelector('#viewer');
    const stage = document.querySelector('#viewer-stage');
    const image = document.querySelector('#viewer-image');
    const message = document.querySelector('#viewer-message');
    const control = name => document.querySelector('#viewer-' + name);
    let items = [], current = 0, activeId = 0, opener, previousOverflow;
    let scale = 1, fitScale = 1, offsetX = 0, offsetY = 0, mode = 'fit';
    const pointers = new Map();

    function setDisabled(name, disabled) {
      const button = control(name);
      const wasFocused = document.activeElement === button;
      button.disabled = disabled;
      if (disabled && wasFocused) stage.focus({ preventScroll: true });
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
      control('width').setAttribute('aria-pressed', String(mode === 'width'));
      setDisabled('out', image.hidden || scale <= Math.min(fitScale, 0.1));
      setDisabled('in', image.hidden || scale >= 4);
      setDisabled('fit', image.hidden);
      setDisabled('actual', image.hidden);
      setDisabled('width', image.hidden);
    }

    function measure() {
      fitScale = Math.min(1, Math.max(1, stage.clientWidth - 32) / image.naturalWidth,
        Math.max(1, stage.clientHeight - 32) / image.naturalHeight);
    }

    function reset(nextMode = 'fit') {
      if (image.hidden) return;
      measure();
      mode = nextMode;
      scale = mode === 'actual' ? 1 : mode === 'width' ?
        Math.min(4, Math.max(1, stage.clientWidth - 32) / image.naturalWidth) : fitScale;
      offsetX = 0;
      offsetY = mode === 'fit' ? 0 : Math.max(0, (image.naturalHeight * scale - stage.clientHeight) / 2 + 16);
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

    const viewportKey = page => JSON.stringify(page.viewport);
    function samePageVariants() {
      return galleryRecords.filter(page => page.key === galleryRecords[activeId].key);
    }
    function updateVersionControls(page) {
      const variants = samePageVariants();
      const locales = [...new Set(variants.map(variant => variant.locale))];
      control('locale').innerHTML = locales.map(locale => '<option value="' + html(locale) + '">' +
        html(localeNames[locale] || locale) + '</option>').join('');
      control('locale').value = page.locale;
      control('locale').disabled = locales.length <= 1;
      const viewports = [...new Map(variants.filter(variant => variant.locale === page.locale)
        .map(variant => [viewportKey(variant), variant])).values()];
      control('viewport').innerHTML = viewports.map(variant => '<option value="' + html(viewportKey(variant)) + '">' +
        html((variant.viewport.label === 'mobile' ? '手机' : '电脑') + ' · ' + variant.viewport.width +
          ' × ' + variant.viewport.height) + '</option>').join('');
      control('viewport').value = viewportKey(page);
      control('viewport').disabled = viewports.length <= 1;
    }

    function show(index, variantId = items[index]) {
      current = index;
      activeId = variantId;
      clearPointers();
      const page = galleryRecords[activeId];
      control('title').textContent = displayPageName(page.page);
      control('title').title = page.label;
      control('position').textContent = (current + 1) + ' / ' + items.length + ' · 当前浏览结果' +
        (activeId !== items[current] ? ' · 同页其他版本' : '');
      control('meta').textContent = pageMeta(page);
      control('original').href = control('download').href = page.file;
      updateVersionControls(page);
      setDisabled('prev', current === 0);
      setDisabled('next', current === items.length - 1);
      image.hidden = true;
      message.hidden = false;
      message.textContent = '正在加载图片…';
      image.alt = page.label + ' 页面截图';
      offsetX = offsetY = 0;
      paint();
      image.src = page.file;
    }

    image.addEventListener('load', () => {
      if (!viewer.open) return;
      image.hidden = false;
      message.hidden = true;
      if (mode === 'manual') { measure(); paint(); } else reset(mode);
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      message.hidden = false;
      message.textContent = '图片加载失败，请尝试打开原图，或切换到其他截图。';
      paint();
    });

    document.querySelector('#gallery-sections').addEventListener('click', event => {
      const link = event.target.closest('.snapshot-link');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      selectGalleryLink(link);
      items = getGalleryItems();
      const id = Number(link.closest('.snapshot-item').dataset.id);
      const index = items.indexOf(id);
      if (index < 0) return;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      mode = 'fit';
      scale = 1;
      control('shortcuts').open = false;
      viewer.showModal();
      show(index);
      stage.focus({ preventScroll: true });
    });
    control('locale').addEventListener('change', () => {
      const page = galleryRecords[activeId];
      const variants = samePageVariants().filter(variant => variant.locale === control('locale').value);
      const next = variants.find(variant => viewportKey(variant) === viewportKey(page)) || variants[0];
      if (next) { show(current, next.id); stage.focus({ preventScroll: true }); }
    });
    control('viewport').addEventListener('change', () => {
      const page = galleryRecords[activeId];
      const next = samePageVariants().find(variant => variant.locale === page.locale &&
        viewportKey(variant) === control('viewport').value);
      if (next) { show(current, next.id); stage.focus({ preventScroll: true }); }
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
    control('width').addEventListener('click', () => reset('width'));
    control('close').addEventListener('click', () => viewer.close());
    viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
    viewer.addEventListener('close', () => {
      clearPointers();
      document.body.style.overflow = previousOverflow;
      const selected = keyboardLinks.find(link => Number(link.closest('.snapshot-item').dataset.id) === items[current]) || opener;
      selectGalleryLink(selected, { focus: true, scroll: selected !== opener });
    });
    function pan(x, y) {
      if (image.hidden) return;
      offsetX += x;
      offsetY += y;
      paint();
    }
    function cycleVersion(name, reverse) {
      const select = control(name);
      if (select.options.length <= 1) return;
      select.selectedIndex = (select.selectedIndex + (reverse ? -1 : 1) + select.options.length) % select.options.length;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // 模态框打开时统一接收键盘，避免切换版本或点击图片后焦点变化导致快捷键失效。
    document.addEventListener('keydown', event => {
      if (!viewer.open || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Tab') {
        const focusable = Array.from(viewer.querySelectorAll('button:not([disabled]), select:not([disabled]), a[href], summary, [tabindex="0"]'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!viewer.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (event.target.matches?.('select') && ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const actions = {
        ArrowLeft: () => event.shiftKey ? pan(80, 0) : navigate(-1),
        ArrowRight: () => event.shiftKey ? pan(-80, 0) : navigate(1),
        ArrowUp: () => pan(0, 80), ArrowDown: () => pan(0, -80),
        PageUp: () => pan(0, stage.clientHeight * .9), PageDown: () => pan(0, -stage.clientHeight * .9),
        Home: () => { offsetY = Math.max(0, (image.naturalHeight * scale - stage.clientHeight) / 2 + 16); paint(); },
        End: () => { offsetY = -Math.max(0, (image.naturalHeight * scale - stage.clientHeight) / 2 + 16); paint(); },
        '+': () => zoom(scale * 1.25), '=': () => zoom(scale * 1.25),
        '-': () => zoom(scale / 1.25), '0': () => reset(), '1': () => reset('actual'), '2': () => reset('width'),
        l: () => cycleVersion('locale', event.shiftKey), v: () => cycleVersion('viewport', event.shiftKey),
        o: () => control('original').click(), d: () => control('download').click(),
        '?': () => { control('shortcuts').open = !control('shortcuts').open; },
        Escape: () => viewer.close(),
      };
      if (actions[key]) {
        event.preventDefault();
        actions[key]();
        if (viewer.open && event.target.matches?.('select')) stage.focus({ preventScroll: true });
      }
    });

    stage.addEventListener('wheel', event => {
      event.preventDefault();
      stage.focus({ preventScroll: true });
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect = stage.getBoundingClientRect();
        const delta = event.deltaY * factor;
        zoom(scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002),
          event.clientX - rect.left, event.clientY - rect.top);
      } else if (event.shiftKey) {
        pan(-(event.deltaX || event.deltaY) * factor, 0);
      } else {
        pan(-event.deltaX * factor, -event.deltaY * factor);
      }
    }, { passive: false });
    stage.addEventListener('dblclick', event => {
      if (!event.target.closest('button, a, select')) reset(Math.abs(scale - 1) < 0.01 ? 'fit' : 'actual');
    });
    stage.addEventListener('pointerdown', event => {
      if (image.hidden || event.button !== 0 || event.target.closest('button, a, select')) return;
      stage.focus({ preventScroll: true });
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
      if (mode === 'fit' || mode === 'width') reset(mode); else paint();
    }).observe(stage);
`;
