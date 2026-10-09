const filter = document.querySelector('#filter');
const sections = Array.from(document.querySelectorAll('.module-section'));
const buttons = Array.from(document.querySelectorAll('[data-module]'));
let selectedModule = '';

/** 根据模块与搜索词筛选截图卡片，更新各模块计数和空结果提示。 */
function updateGallery() {
  const terms = filter.value.trim().toLowerCase().split(/[\s,，]+/).filter(Boolean);
  let visibleCards = 0;
  let visibleModules = 0;
  sections.forEach(section => {
    const moduleSelected = !selectedModule || section.dataset.group === selectedModule;
    let sectionCount = 0;
    section.querySelectorAll('article').forEach(card => {
      const searchableText = card.dataset.search.toLowerCase();
      card.hidden = !moduleSelected || !terms.every(term => searchableText.includes(term));
      if (!card.hidden) sectionCount++;
    });
    section.hidden = sectionCount === 0;
    section.querySelector('[data-module-count]').textContent = sectionCount + ' 张';
    visibleCards += sectionCount;
    if (sectionCount > 0) visibleModules++;
  });
  document.querySelector('#count').textContent = '显示 ' + visibleCards + ' 张 · ' + visibleModules + ' 个模块';
  document.querySelector('#empty').hidden = visibleCards !== 0;
}

buttons.forEach(button => button.addEventListener('click', () => {
  selectedModule = button.dataset.module;
  buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  updateGallery();
}));
filter.addEventListener('input', updateGallery);
const viewer = document.querySelector('#viewer');
const stage = document.querySelector('#viewer-stage');
const image = document.querySelector('#viewer-image');
const message = document.querySelector('#viewer-message');
/**
 * 按名称定位截图查看器中的操作控件。
 * @param name - 查看器控件的名称后缀。
 */
const control = name => document.querySelector('#viewer-' + name);
let items = [], current = 0, opener, previousOverflow;
let scale = 1, fitScale = 1, offsetX = 0, offsetY = 0, mode = 'fit';
const pointers = new Map();

/**
 * 设置操作按钮可用状态，被禁用按钮持有焦点时转移到关闭按钮。
 * @param name - 待设置的查看器按钮名称。
 * @param disabled - 按钮是否禁用。
 */
function setDisabled(name, disabled) {
  const button = control(name);
  const wasFocused = document.activeElement === button;
  button.disabled = disabled;
  if (disabled && wasFocused) control('close').focus();
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
  setDisabled('out', image.hidden || scale <= Math.min(fitScale, 0.1));
  setDisabled('in', image.hidden || scale >= 4);
  setDisabled('fit', image.hidden);
  setDisabled('actual', image.hidden);
}

/** 根据容器与图片原始尺寸计算适应窗口的缩放比例。 */
function measure() {
  fitScale = Math.min(1, Math.max(1, stage.clientWidth - 32) / image.naturalWidth,
    Math.max(1, stage.clientHeight - 32) / image.naturalHeight);
}

/**
 * 切换适应窗口或原始像素模式，并清空此前的拖动位移。
 * @param nextMode - 缩放模式：fit 为适应窗口，actual 为原始像素。
 */
function reset(nextMode = 'fit') {
  if (image.hidden) return;
  measure();
  mode = nextMode;
  scale = mode === 'actual' ? 1 : fitScale;
  offsetX = offsetY = 0;
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
 * 加载当前筛选结果中的指定截图，更新标题、下载链接和导航状态。
 * @param index - 当前筛选结果中的截图索引。
 */
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
    /** 按左方向键切换到上一张截图。 */
    ArrowLeft: () => navigate(-1),
    /** 按右方向键切换到下一张截图。 */
    ArrowRight: () => navigate(1),
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
  if (mode === 'fit') reset(); else paint();
}).observe(stage);
