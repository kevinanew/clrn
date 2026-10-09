// 生成图库时嵌入同一脚本；跨文件引用的变量由 ESLint 配置显式声明。
const viewer = document.querySelector('#viewer');
const stage = document.querySelector('#viewer-stage');
const image = document.querySelector('#viewer-image');
const message = document.querySelector('#viewer-message');
/**
 * 按名称定位截图查看器中的操作控件。
 * @param name - 查看器控件的 ID 后缀。
 */
const control = name => document.querySelector('#viewer-' + name);
let items = [], current = 0, activeId = 0, viewerOpener, previousOverflow;
let scale = 1, fitScale = 1, offsetX = 0, offsetY = 0, mode = 'fit';
const pointers = new Map();

/**
 * 设置按钮可用状态，禁用当前焦点按钮时将焦点移至大图区域。
 * @param name - 查看器控件的 ID 后缀。
 * @param disabled - 按钮是否禁用。
 */
function setDisabled(name, disabled) {
  const button = control(name);
  const wasFocused = document.activeElement === button;
  button.disabled = disabled;
  if (disabled && wasFocused) stage.focus({ preventScroll: true });
}

/** 限制图片平移范围并绘制缩放位置，同步缩放比例和按钮状态。 */
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

/** 根据容器与图片原始尺寸计算适应窗口的缩放比例。 */
function measure() {
  fitScale = Math.min(1, Math.max(1, stage.clientWidth - 32) / image.naturalWidth,
    Math.max(1, stage.clientHeight - 32) / image.naturalHeight);
}

/**
 * 切换适应窗口、原始像素或适应宽度模式并重置位移。
 * @param nextMode - fit 适应窗口，actual 原始像素，width 适应宽度。
 */
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

/**
 * 围绕给定坐标缩放图片，在允许范围内保留缩放中心。
 * @param nextScale - 期望的图片缩放倍数。
 * @param x - 相对查看器容器的缩放中心横坐标。
 * @param y - 相对查看器容器的缩放中心纵坐标。
 */
function zoom(nextScale, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
  if (image.hidden) return;
  const before = scale;
  scale = Math.max(Math.min(fitScale, 0.1), Math.min(4, nextScale));
  offsetX = (offsetX - x + stage.clientWidth / 2) * scale / before + x - stage.clientWidth / 2;
  offsetY = (offsetY - y + stage.clientHeight / 2) * scale / before + y - stage.clientHeight / 2;
  mode = 'manual';
  paint();
}

/** 释放全部触摸指针捕获并重置拖动状态。 */
function clearPointers() {
  pointers.forEach((_, id) => {
    if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
  });
  pointers.clear();
  stage.dataset.dragging = 'false';
}

/**
 * 序列化视口配置，用于匹配同页的设备版本。
 * @param page - 待展示或分组的截图元数据。
 */
const viewportKey = page => JSON.stringify(page.viewport);
/** 取得大图当前页面的所有语言和设备版本。 */
function samePageVariants() {
  return galleryRecords.filter(page => page.key === galleryRecords[activeId].key);
}
/**
 * 根据同页版本更新语言和设备选择项及可用状态。
 * @param page - 待展示或分组的截图元数据。
 */
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

/**
 * 加载浏览结果中的截图或同页的其他版本，并更新导航与版本控件。
 * @param index - 当前浏览结果中的截图索引。
 * @param variantId - 要打开的截图版本 ID，默认使用浏览结果当前项。
 */
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
  viewerOpener = link;
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

/**
 * 在当前筛选结果内切换截图，边界外的操作保持当前图片。
 * @param delta - 相对当前截图的索引增量。
 */
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
  /**
   * 查找图库中给定截图的预览链接。
   * @param id - 待查找的截图版本 ID。
   */
  const linkFor = id => keyboardLinks.find(link => Number(link.closest('.snapshot-item').dataset.id) === id);
  let selected = linkFor(activeId);
  if (!selected && byId('view-mode').value === 'pages') {
    const row = rows.find(row => row.variants.some(page => page.id === activeId));
    const card = row && Array.from(byId('gallery-sections').querySelectorAll('article'))
      .find(card => card.dataset.row === row.key);
    if (card) {
      setGalleryVariant(card, galleryRecords[activeId]);
      selected = linkFor(activeId);
    }
  }
  selected = selected || linkFor(items[current]) || viewerOpener;
  selectGalleryLink(selected, { focus: true, scroll: selected !== viewerOpener });
});
/**
 * 按位移平移大图，并将缩放模式切为手动。
 * @param x - 水平方向的平移量，单位为像素。
 * @param y - 垂直方向的平移量，单位为像素。
 */
function pan(x, y) {
  if (image.hidden) return;
  offsetX += x;
  offsetY += y;
  paint();
}
/**
 * 循环切换大图的语言或设备版本。
 * @param name - 查看器控件的 ID 后缀。
 * @param reverse - 是否沿反方向切换。
 */
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
    /** 按左方向键切换到上一张截图。 */
    ArrowLeft: () => event.shiftKey ? pan(80, 0) : navigate(-1),
    /** 按右方向键切换到下一张截图。 */
    ArrowRight: () => event.shiftKey ? pan(-80, 0) : navigate(1),
    /** 向上浏览当前截图。 */
    ArrowUp: () => pan(0, 80),
      /** 向下浏览当前截图。 */
      ArrowDown: () => pan(0, -80),
    /** 向上浏览一屏。 */
    PageUp: () => pan(0, stage.clientHeight * .9),
      /** 向下浏览一屏。 */
      PageDown: () => pan(0, -stage.clientHeight * .9),
    /** 跳到当前浏览区域的起始位置。 */
    Home: () => { offsetY = Math.max(0, (image.naturalHeight * scale - stage.clientHeight) / 2 + 16); paint(); },
    /** 跳到当前浏览区域的末尾位置。 */
    End: () => { offsetY = -Math.max(0, (image.naturalHeight * scale - stage.clientHeight) / 2 + 16); paint(); },
    /** 按加号键放大当前截图。 */
    '+': () => zoom(scale * 1.25),
      /** 按等号键放大当前截图，兼容无需 Shift 的键盘操作。 */
      '=': () => zoom(scale * 1.25),
    /** 按减号键缩小当前截图。 */
    '-': () => zoom(scale / 1.25),
      /** 按数字零恢复适应窗口模式。 */
      '0': () => reset(),
      /** 按数字一恢复原始像素比例。 */
      '1': () => reset('actual'),
      /** 按数字二切换适应宽度模式。 */
      '2': () => reset('width'),
    /** 循环切换语言版本。 */
    l: () => cycleVersion('locale', event.shiftKey),
      /** 循环切换设备版本。 */
      v: () => cycleVersion('viewport', event.shiftKey),
    /** 打开当前截图的原始文件。 */
    o: () => control('original').click(),
      /** 下载当前截图原始文件。 */
      d: () => control('download').click(),
    /** 展开或收起大图快捷键说明。 */
    '?': () => { control('shortcuts').open = !control('shortcuts').open; },
    /** 关闭大图查看器。 */
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
    /**
     * 计算两根触摸指针的距离，用于双指缩放。
     * @param points - 两根触摸指针的坐标。
     */
    const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    /**
     * 计算两根触摸指针的中点，作为双指缩放中心。
     * @param points - 两根触摸指针的坐标。
     */
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
/**
 * 移除已结束或取消的指针，并更新查看器拖动标记。
 * @param event - 结束、取消或失去捕获的指针事件。
 */
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
