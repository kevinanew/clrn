// 生成图库时嵌入同一脚本；跨文件引用的变量由 ESLint 配置显式声明。
/* exported keyboardLinks, selectGalleryLink, syncGallerySelection */
let keyboardLinks = [], selectedGalleryId = null, selectedGalleryLink = null;
const galleryHelp = byId('gallery-shortcuts');
let galleryHelpOpener, galleryHelpOverflow;

/**
 * 选中截图链接，更新卡片标记、详情和可选焦点。
 * @param link - 需要选中的预览链接。
 * @param options - focus 指定是否聚焦，scroll 指定是否滚动到截图。
 */
function selectGalleryLink(link, options = {}) {
  const { focus = false, scroll = false } = options;
  if (!link) {
    if (focus) byId('empty-reset').focus();
    return;
  }
  if (selectedGalleryLink) {
    selectedGalleryLink.tabIndex = -1;
    selectedGalleryLink.removeAttribute('aria-current');
    const previous = selectedGalleryLink.closest('article');
    delete previous.dataset.selected;
    previous.querySelectorAll('.variant-select, .card-bottom summary').forEach(control => { control.tabIndex = -1; });
  }
  selectedGalleryLink = link;
  selectedGalleryId = Number(link.closest('.snapshot-item').dataset.id);
  link.tabIndex = 0;
  link.setAttribute('aria-current', 'true');
  const card = link.closest('article');
  card.dataset.selected = 'true';
  card.querySelectorAll('.variant-select, .card-bottom summary').forEach(control => { control.tabIndex = 0; });
  const record = galleryRecords[selectedGalleryId];
  card.querySelector('.card-bottom code').innerHTML = snapshotDetailsMarkup(record);
  byId('gallery-selection').textContent = '已选 ' + (keyboardLinks.indexOf(link) + 1) + ' / ' + keyboardLinks.length +
    '：' + displayPageName(record.page) + '，' + variantLabel(record);
  if (focus) link.focus({ preventScroll: true });
  if (scroll) link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * 绘制后恢复原截图选择，找不到时选择首张匹配截图。
 * @param restoreFocus - 是否在恢复选择后重新聚焦截图。
 */
function syncGallerySelection(restoreFocus = false) {
  const previousKey = selectedGalleryId === null ? null : galleryRecords[selectedGalleryId].key;
  keyboardLinks = Array.from(byId('gallery-sections').querySelectorAll('.snapshot-link'));
  keyboardLinks.forEach(link => { link.tabIndex = -1; link.removeAttribute('aria-current'); });
  byId('gallery-sections').querySelectorAll('.variant-select, .card-bottom summary').forEach(control => { control.tabIndex = -1; });
  const next = keyboardLinks.find(link => Number(link.closest('.snapshot-item').dataset.id) === selectedGalleryId) ||
    keyboardLinks.find(link => galleryRecords[Number(link.closest('.snapshot-item').dataset.id)].key === previousKey) || keyboardLinks[0];
  selectedGalleryLink = null;
  selectedGalleryId = null;
  byId('gallery-selection').textContent = keyboardLinks.length ? '' : '没有匹配的截图';
  selectGalleryLink(next, { focus: restoreFocus });
}
/** 将焦点移回当前选中的截图并滚动到可见位置。 */
function focusGallerySelection() { selectGalleryLink(selectedGalleryLink, { focus: true, scroll: true }); }
/**
 * 选择给定索引的截图，超出范围时停留在边界。
 * @param index - 当前浏览结果中的截图索引。
 */
function selectIndex(index) {
  if (!keyboardLinks.length) return focusGallerySelection();
  selectGalleryLink(keyboardLinks[Math.max(0, Math.min(keyboardLinks.length - 1, index))], { focus: true, scroll: true });
}
/**
 * 沿图库顺序移动指定数量的截图。
 * @param delta - 相对当前截图的索引增量。
 */
function moveGallerySelection(delta) { selectIndex(keyboardLinks.indexOf(selectedGalleryLink) + delta); }
/**
 * 按卡片实际位置向上或向下选择，支持跨屏移动。
 * @param direction - 移动方向，负数向上，正数向下。
 * @param screen - 是否按一屏高度移动。
 */
function moveGalleryVertically(direction, screen = false) {
  if (!selectedGalleryLink) return focusGallerySelection();
  const current = selectedGalleryLink.closest('article').getBoundingClientRect();
  const currentX = selectedGalleryLink.getBoundingClientRect();
  const y = (current.top + current.bottom) / 2, x = (currentX.left + currentX.right) / 2;
  const targetY = y + (screen ? direction * window.innerHeight * .8 : 0);
  const candidates = keyboardLinks.map(link => {
    const card = link.closest('article').getBoundingClientRect(), box = link.getBoundingClientRect();
    return { link, y: (card.top + card.bottom) / 2, x: (box.left + box.right) / 2 };
  }).filter(item => (item.y - y) * direction > 1).sort((a, b) =>
    Math.abs(a.y - targetY) - Math.abs(b.y - targetY) || Math.abs(a.x - x) - Math.abs(b.x - x));
  if (candidates.length) selectGalleryLink(candidates[0].link, { focus: true, scroll: true });
  else moveGallerySelection(direction * (screen ? 10 : 1));
}

/**
 * 展开指定筛选控件所在的筛选栏。
 * @param id - 控件在 HTML 中的 ID。
 */
function revealGalleryControl(id) {
  byId('gallery').querySelector('.toolbar').classList.add('filters-open');
  byId('toggle-filters').setAttribute('aria-expanded', 'true');
  if (['resolution', 'auth', 'thumbnail-size'].includes(id)) document.querySelector('.more-filters').open = true;
}
/**
 * 循环切换筛选项，然后将焦点返回截图。
 * @param id - 控件在 HTML 中的 ID。
 * @param reverse - 是否沿反方向切换。
 */
function cycleGalleryControl(id, reverse) {
  revealGalleryControl(id);
  const select = byId(id);
  select.selectedIndex = (select.selectedIndex + (reverse ? -1 : 1) + select.options.length) % select.options.length;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  focusGallerySelection();
}
/**
 * 沿模块按钮顺序循环切换筛选模块。
 * @param delta - 相对当前模块的索引增量。
 */
function cycleGalleryModule(delta) {
  const index = moduleButtons.findIndex(button => button.dataset.module === selectedModule);
  const next = moduleButtons[(index + delta + moduleButtons.length) % moduleButtons.length];
  next.click();
  focusGallerySelection();
}
/**
 * 循环切换选中页面的截图版本。
 * @param reverse - 是否沿反方向切换。
 */
function cycleGalleryVersion(reverse) {
  if (!selectedGalleryLink) return;
  const select = selectedGalleryLink.closest('article').querySelector('.variant-select');
  if (select) {
    select.selectedIndex = (select.selectedIndex + (reverse ? -1 : 1) + select.options.length) % select.options.length;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    focusGallerySelection();
  } else {
    const key = galleryRecords[selectedGalleryId].key;
    const variants = keyboardLinks.filter(link => galleryRecords[Number(link.closest('.snapshot-item').dataset.id)].key === key);
    const next = (variants.indexOf(selectedGalleryLink) + (reverse ? -1 : 1) + variants.length) % variants.length;
    selectGalleryLink(variants[next], { focus: true, scroll: true });
  }
}
/** 展开或收起当前截图的详细信息。 */
function toggleGalleryDetails() {
  const details = selectedGalleryLink?.closest('article').querySelector('.card-bottom details');
  if (!details) return;
  details.open = !details.open;
  if (details.open) details.scrollIntoView({ block: 'nearest' });
}
/**
 * 打开或下载当前截图的原始文件。
 * @param download - 是否下载文件而非打开新窗口。
 */
function openGalleryResource(download) {
  if (!selectedGalleryLink) return;
  const link = document.createElement('a');
  link.href = selectedGalleryLink.href;
  link.className = 'keyboard-resource';
  link.hidden = true;
  link.rel = 'noopener';
  if (download) link.setAttribute('download', ''); else link.target = '_blank';
  document.body.append(link);
  link.click();
  link.remove();
}
/** 切换快捷键说明并保存打开前的焦点和滚动状态。 */
function toggleGalleryHelp() {
  if (byId('viewer').open) return;
  if (galleryHelp.open) return galleryHelp.close();
  galleryHelpOpener = document.activeElement;
  galleryHelpOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  galleryHelp.showModal();
  byId('gallery-shortcuts-close').focus({ preventScroll: true });
}
byId('gallery-help').addEventListener('click', toggleGalleryHelp);
byId('gallery-shortcuts-close').addEventListener('click', () => galleryHelp.close());
galleryHelp.addEventListener('close', () => {
  document.body.style.overflow = galleryHelpOverflow;
  if (galleryHelpOpener?.isConnected) galleryHelpOpener.focus({ preventScroll: true }); else focusGallerySelection();
});
byId('gallery-sections').addEventListener('focusin', event => {
  const card = event.target.closest('article');
  const link = event.target.closest('.snapshot-link') ||
    (card && selectedGalleryLink?.closest('article') === card ? selectedGalleryLink : card?.querySelector('.snapshot-link'));
  if (link) selectGalleryLink(link);
});

document.addEventListener('keydown', event => {
  if (byId('viewer').open || event.defaultPrevented || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (galleryHelp.open) {
    if (key === 'Escape' || key === '?') { event.preventDefault(); galleryHelp.close(); }
    else if (key === 'Tab') { event.preventDefault(); byId('gallery-shortcuts-close').focus(); }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'k' && !event.altKey && !event.shiftKey) {
    event.preventDefault(); byId('filter').focus(); byId('filter').select(); return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (key === 'Escape') {
    event.preventDefault();
    document.querySelector('.more-filters').open = false;
    byId('gallery-about').open = false;
    focusGallerySelection();
    return;
  }
  if (target?.closest('input, textarea, [contenteditable="true"]')) {
    if (target.id === 'filter' && key === 'Enter') { event.preventDefault(); focusGallerySelection(); }
    return;
  }
  if (target?.matches('select') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(key)) return;
  const moduleButton = target?.closest('[data-module]');
  if (moduleButton && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
    event.preventDefault();
    const delta = ['ArrowLeft', 'ArrowUp'].includes(key) ? -1 : 1;
    const next = moduleButtons[(moduleButtons.indexOf(moduleButton) + delta + moduleButtons.length) % moduleButtons.length];
    moduleButtons.forEach(button => { button.tabIndex = button === next ? 0 : -1; });
    next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return;
  }
  if ((key === 'Enter' || key === ' ') && (target?.closest('.snapshot-link') || !target?.closest('button, a, summary, select'))) {
    if (selectedGalleryLink) { event.preventDefault(); selectedGalleryLink.click(); }
    return;
  }
  const actions = {
    /** 聚焦搜索框并选中已有搜索词。 */
    '/': () => { byId('filter').focus(); byId('filter').select(); },
    /** 聚焦当前模块；按 Shift 时切换全部模块。 */
    m: () => {
      if (event.shiftKey) { moduleButtons[0].click(); focusGallerySelection(); }
      else { const button = moduleButtons.find(item => item.dataset.module === selectedModule); button.focus(); button.scrollIntoView({ block: 'nearest' }); }
    },
    /** 切换到上一个模块。 */
    '[': () => cycleGalleryModule(-1),
      /** 切换到下一个模块。 */
      ']': () => cycleGalleryModule(1),
    /** 循环切换语言版本。 */
    l: () => cycleGalleryControl('locale', event.shiftKey),
      /** 循环切换设备版本。 */
      v: () => cycleGalleryControl('device', event.shiftKey),
    /** 循环切换分辨率筛选。 */
    r: () => cycleGalleryControl('resolution', event.shiftKey),
      /** 循环切换登录状态筛选。 */
      a: () => cycleGalleryControl('auth', event.shiftKey),
    /** 循环切换浏览或对比模式。 */
    c: () => cycleGalleryControl('view-mode', event.shiftKey),
      /** 循环切换预览大小。 */
      s: () => cycleGalleryControl('thumbnail-size', event.shiftKey),
    /** 展开或收起筛选栏。 */
    f: () => byId('toggle-filters').click(),
    /** 展开或收起更多筛选。 */
    e: () => { revealGalleryControl('locale'); const details = document.querySelector('.more-filters'); details.open = !details.open; },
    /** 清除筛选并返回截图。 */
    x: () => { resetFilters(); focusGallerySelection(); }, g: focusGallerySelection,
    /** 选择下一张截图。 */
    j: () => moveGallerySelection(1),
      /** 选择上一张截图。 */
      k: () => moveGallerySelection(-1),
    /** 按左方向键切换到上一张截图。 */
    ArrowLeft: () => moveGallerySelection(-1),
      /** 按右方向键切换到下一张截图。 */
      ArrowRight: () => moveGallerySelection(1),
    /** 向上浏览当前截图。 */
    ArrowUp: () => moveGalleryVertically(-1),
      /** 向下浏览当前截图。 */
      ArrowDown: () => moveGalleryVertically(1),
    /** 跳到当前浏览区域的起始位置。 */
    Home: () => selectIndex(0),
      /** 跳到当前浏览区域的末尾位置。 */
      End: () => selectIndex(keyboardLinks.length - 1),
    /** 向上浏览一屏。 */
    PageUp: () => moveGalleryVertically(-1, true),
      /** 向下浏览一屏。 */
      PageDown: () => moveGalleryVertically(1, true),
    /** 循环切换当前截图版本。 */
    w: () => cycleGalleryVersion(event.shiftKey), t: toggleGalleryDetails,
    /** 打开当前截图的原始文件。 */
    o: () => openGalleryResource(false),
      /** 下载当前截图原始文件。 */
      d: () => openGalleryResource(true),
    /** 展开或收起图库说明并滚动到说明位置。 */
    b: () => { const about = byId('gallery-about'); about.open = !about.open; about.scrollIntoView({ block: 'nearest' }); },
    /** 打开截图清单。 */
    p: () => byId('manifest-link').click(), '?': toggleGalleryHelp,
  };
  if (actions[key]) { event.preventDefault(); actions[key](); }
});
