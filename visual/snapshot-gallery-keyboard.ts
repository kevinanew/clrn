export const galleryKeyboardMarkup = `
  <dialog id="gallery-shortcuts" aria-labelledby="gallery-shortcuts-title">
    <div class="shortcut-heading"><h2 id="gallery-shortcuts-title">全程用键盘看截图</h2><button id="gallery-shortcuts-close" type="button" aria-label="关闭快捷键说明">关闭 <kbd aria-hidden="true">Esc</kbd></button></div>
    <p>先用方向键选图，再按 Enter 放大。搜索框内照常打字；下拉框用 ↑ ↓ 选择，Enter 确认，Esc 返回图片。</p>
    <dl>
      <dt>搜索 / 回到图片</dt><dd><kbd>/</kbd> 或 <kbd>Ctrl/⌘ + K</kbd> / <kbd>G</kbd></dd>
      <dt>选择图片 / 打开放大图</dt><dd><kbd>← ↑ ↓ →</kbd> 或 <kbd>J / K</kbd> / <kbd>Enter</kbd>、<kbd>Space</kbd></dd>
      <dt>第一张 / 最后一张</dt><dd><kbd>Home</kbd> / <kbd>End</kbd></dd>
      <dt>向上 / 向下浏览一屏</dt><dd><kbd>PageUp</kbd> / <kbd>PageDown</kbd></dd>
      <dt>选择模块 / 全部模块</dt><dd><kbd>M</kbd>，再用方向键、Enter / <kbd>Shift + M</kbd></dd>
      <dt>上一个 / 下一个模块</dt><dd><kbd>[</kbd> / <kbd>]</kbd></dd>
      <dt>切换语言 / 设备</dt><dd><kbd>L</kbd> / <kbd>V</kbd></dd>
      <dt>切换浏览或对比方式</dt><dd><kbd>C</kbd></dd>
      <dt>切换分辨率 / 登录状态</dt><dd><kbd>R</kbd> / <kbd>A</kbd></dd>
      <dt>切换预览图片大小</dt><dd><kbd>S</kbd></dd>
      <dt>切换选中图片的版本</dt><dd><kbd>W</kbd></dd>
      <dt>展开 / 收起筛选与更多筛选</dt><dd><kbd>F</kbd> / <kbd>E</kbd></dd>
      <dt>查看 / 收起选中图片的详情</dt><dd><kbd>T</kbd></dd>
      <dt>打开选中图片的原图 / 下载</dt><dd><kbd>O</kbd> / <kbd>D</kbd></dd>
      <dt>查看截图说明 / 打开页面清单</dt><dd><kbd>B</kbd> / <kbd>P</kbd></dd>
      <dt>清除所有筛选</dt><dd><kbd>X</kbd></dd>
      <dt>查看 / 收起快捷键说明</dt><dd><kbd>?</kbd>（Shift + /）</dd>
      <dt>返回图片 / 关闭浮层</dt><dd><kbd>Esc</kbd></dd>
      <dt>切换控件 / 操作控件</dt><dd><kbd>Tab</kbd>、<kbd>Shift + Tab</kbd> / <kbd>Enter</kbd>、<kbd>Space</kbd></dd>
    </dl>
    <p>L、V、C、R、A、S、W 加 Shift 可反向切换。放大后，所有按钮旁也有快捷键；按 ? 查看大图的完整操作。</p>
  </dialog>
`;

export const galleryKeyboardScript = String.raw`
    let keyboardLinks = [], selectedGalleryId = null, selectedGalleryLink = null;
    const galleryHelp = byId('gallery-shortcuts');
    let galleryHelpOpener, galleryHelpOverflow;

    function selectGalleryLink(link, { focus = false, scroll = false } = {}) {
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
    function focusGallerySelection() { selectGalleryLink(selectedGalleryLink, { focus: true, scroll: true }); }
    function selectIndex(index) {
      if (!keyboardLinks.length) return focusGallerySelection();
      selectGalleryLink(keyboardLinks[Math.max(0, Math.min(keyboardLinks.length - 1, index))], { focus: true, scroll: true });
    }
    function moveGallerySelection(delta) { selectIndex(keyboardLinks.indexOf(selectedGalleryLink) + delta); }
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

    function revealGalleryControl(id) {
      byId('gallery').querySelector('.toolbar').classList.add('filters-open');
      byId('toggle-filters').setAttribute('aria-expanded', 'true');
      if (['resolution', 'auth', 'thumbnail-size'].includes(id)) document.querySelector('.more-filters').open = true;
    }
    function cycleGalleryControl(id, reverse) {
      revealGalleryControl(id);
      const select = byId(id);
      select.selectedIndex = (select.selectedIndex + (reverse ? -1 : 1) + select.options.length) % select.options.length;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      focusGallerySelection();
    }
    function cycleGalleryModule(delta) {
      const index = moduleButtons.findIndex(button => button.dataset.module === selectedModule);
      const next = moduleButtons[(index + delta + moduleButtons.length) % moduleButtons.length];
      next.click();
      focusGallerySelection();
    }
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
    function toggleGalleryDetails() {
      const details = selectedGalleryLink?.closest('article').querySelector('.card-bottom details');
      if (!details) return;
      details.open = !details.open;
      if (details.open) details.scrollIntoView({ block: 'nearest' });
    }
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
        '/': () => { byId('filter').focus(); byId('filter').select(); },
        m: () => {
          if (event.shiftKey) { moduleButtons[0].click(); focusGallerySelection(); }
          else { const button = moduleButtons.find(item => item.dataset.module === selectedModule); button.focus(); button.scrollIntoView({ block: 'nearest' }); }
        },
        '[': () => cycleGalleryModule(-1), ']': () => cycleGalleryModule(1),
        l: () => cycleGalleryControl('locale', event.shiftKey), v: () => cycleGalleryControl('device', event.shiftKey),
        r: () => cycleGalleryControl('resolution', event.shiftKey), a: () => cycleGalleryControl('auth', event.shiftKey),
        c: () => cycleGalleryControl('view-mode', event.shiftKey), s: () => cycleGalleryControl('thumbnail-size', event.shiftKey),
        f: () => byId('toggle-filters').click(),
        e: () => { revealGalleryControl('locale'); const details = document.querySelector('.more-filters'); details.open = !details.open; },
        x: () => { resetFilters(); focusGallerySelection(); }, g: focusGallerySelection,
        j: () => moveGallerySelection(1), k: () => moveGallerySelection(-1),
        ArrowLeft: () => moveGallerySelection(-1), ArrowRight: () => moveGallerySelection(1),
        ArrowUp: () => moveGalleryVertically(-1), ArrowDown: () => moveGalleryVertically(1),
        Home: () => selectIndex(0), End: () => selectIndex(keyboardLinks.length - 1),
        PageUp: () => moveGalleryVertically(-1, true), PageDown: () => moveGalleryVertically(1, true),
        w: () => cycleGalleryVersion(event.shiftKey), t: toggleGalleryDetails,
        o: () => openGalleryResource(false), d: () => openGalleryResource(true),
        b: () => { const about = byId('gallery-about'); about.open = !about.open; about.scrollIntoView({ block: 'nearest' }); },
        p: () => byId('manifest-link').click(), '?': toggleGalleryHelp,
      };
      if (actions[key]) { event.preventDefault(); actions[key](); }
    });
`;
