import { galleryKeyboardScript } from './snapshot-gallery-keyboard';
import { LOCALE_NAMES, MODULE_NAMES } from './snapshot-gallery-model';
import { displayPageName, PAGE_NAME_PARTS } from './snapshot-gallery-names';

export const galleryScript = `
    const PAGE_NAME_PARTS = ${JSON.stringify(PAGE_NAME_PARTS)};
    const displayPageName = ${displayPageName.toString()};
    const moduleNames = ${JSON.stringify(MODULE_NAMES)};
    const localeNames = ${JSON.stringify(LOCALE_NAMES)};
` + String.raw`
    const byId = id => document.getElementById(id);
    const normalize = value => value.toLowerCase().replace(/[_-]/g, ' ');
    const html = value => String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
    const variantLabel = page => (localeNames[page.locale] || page.locale) + ' · ' +
      (page.viewport.label === 'mobile' ? '手机' : '电脑') + ' · ' + page.viewport.width + ' × ' + page.viewport.height;
    const pageMeta = page => variantLabel(page) + ' · ' + (page.signedIn ? '已登录' : '游客');
    const galleryRecords = JSON.parse(byId('gallery-data').textContent).map((page, id) => ({
      ...page, id, key: JSON.stringify([page.group, page.page, page.signedIn]),
      search: normalize([displayPageName(page.page), page.label, page.page, page.file, moduleNames[page.group],
        localeNames[page.locale], page.locale === 'en' ? '英文' : '', page.viewport.label,
        variantLabel(page), pageMeta(page), page.viewport.width + 'x' + page.viewport.height,
        ...page.navigation].join(' ')),
    }));
    const moduleButtons = Array.from(document.querySelectorAll('[data-module]'));
    const fields = ['filter', 'locale', 'device', 'resolution', 'auth', 'view-mode', 'thumbnail-size'];
    const defaults = { 'view-mode': 'pages', 'thumbnail-size': '300' };
    const selectedVariants = new Map();
    let selectedModule = '', rows = [], matched = [];

    function readState() {
      const params = new URLSearchParams(location.hash.slice(1));
      fields.forEach(id => {
        const field = byId(id), value = params.get(id) ?? defaults[id] ?? '';
        field.value = field.tagName === 'INPUT' || Array.from(field.options).some(option => option.value === value) ? value : defaults[id] || '';
      });
      selectedModule = moduleButtons.some(button => button.dataset.module === params.get('module')) ? params.get('module') : '';
      if (!window.matchMedia('(max-width: 760px)').matches || fields.some(id =>
        id !== 'filter' && byId(id).value !== (defaults[id] || ''))) {
        byId('gallery').querySelector('.toolbar').classList.add('filters-open');
        byId('toggle-filters').setAttribute('aria-expanded', 'true');
      }
    }

    function saveState() {
      const params = new URLSearchParams();
      fields.forEach(id => {
        const value = byId(id).value;
        if (value !== (defaults[id] || '')) params.set(id, value);
      });
      if (selectedModule) params.set('module', selectedModule);
      const hash = params.toString();
      if (location.hash.slice(1) === hash) return;
      const url = new URL(location.href);
      url.hash = hash;
      try { history.replaceState(null, '', url.href); } catch (_) { location.replace(url.href); }
    }

    function matches(page, terms) {
      return (!byId('locale').value || page.locale === byId('locale').value) &&
        (!byId('device').value || page.viewport.label === byId('device').value) &&
        (!byId('resolution').value || page.viewport.width + 'x' + page.viewport.height === byId('resolution').value) &&
        (!byId('auth').value || (page.signedIn ? 'signed-in' : 'guest') === byId('auth').value) &&
        terms.every(term => page.search.includes(term));
    }

    function preferred(variants, key) {
      const selected = variants.find(page => page.id === selectedVariants.get(key));
      return selected || variants.slice().sort((a, b) =>
        (a.locale === 'zh-Hans' ? 0 : 2) + (a.viewport.label === 'mobile' ? 0 : 1) -
        (b.locale === 'zh-Hans' ? 0 : 2) - (b.viewport.label === 'mobile' ? 0 : 1))[0];
    }

    function buildRows(pages) {
      const mode = byId('view-mode').value, groups = new Map();
      pages.forEach(page => {
        const suffix = mode === 'screenshots' ? page.id : mode === 'languages' ?
          JSON.stringify(page.viewport) : mode === 'devices' ? page.locale : '';
        const key = page.key + ':' + suffix;
        if (!groups.has(key)) groups.set(key, { key, group: page.group, variants: [] });
        groups.get(key).variants.push(page);
      });
      return Object.keys(moduleNames).flatMap(group => Array.from(groups.values()).filter(row => row.group === group));
    }

    function rowItems(row) {
      return byId('view-mode').value === 'pages' ? [preferred(row.variants, row.key)] : row.variants;
    }
    // 连续浏览当前筛选结果；图片由浏览器按需加载。
    function getGalleryItems() { return rows.flatMap(rowItems).map(page => page.id); }

    function snapshotMarkup(page, caption = false) {
      return '<div class="snapshot-item" data-id="' + page.id + '" data-label="' + html(page.label) + '">' +
        (caption ? '<p class="variant-caption">' + html(variantLabel(page)) + '</p>' : '') +
        '<a class="snapshot-link" aria-keyshortcuts="Enter Space" href="' + html(page.file) + '" aria-label="查看截图 ' + html(page.label) + '">' +
        '<img loading="lazy" decoding="async" src="' + html(page.file) + '" alt="' + html(page.label) + ' 页面截图"></a>' +
        '<p class="card-meta">' + html(pageMeta(page)) + '</p></div>';
    }

    function cardMarkup(row) {
      const variants = rowItems(row), page = variants[0], grouped = byId('view-mode').value === 'pages';
      const switcher = grouped && row.variants.length > 1 ?
        '<label class="card-version-label">版本 <kbd aria-hidden="true">W</kbd><select class="variant-select" aria-keyshortcuts="W Shift+W" aria-label="切换 ' + html(page.page) + ' 的版本">' + row.variants.map(variant =>
          '<option value="' + variant.id + '"' + (variant.id === page.id ? ' selected' : '') + '>' +
          html(variantLabel(variant)) + '</option>').join('') + '</select></label>' : '';
      return '<article data-row="' + html(row.key) + '" data-label="' + html(page.label) + '">' +
        '<h3 title="' + html(page.page) + '">' + html(displayPageName(page.page)) + '</h3><div class="variants">' +
        variants.map(variant => snapshotMarkup(variant, !grouped && variants.length > 1)).join('') + '</div>' + switcher +
        '<div class="card-bottom"><details><summary aria-keyshortcuts="T">截图详情 <kbd aria-hidden="true">T</kbd></summary><code>' +
        '原始名称：' + html(page.label) + '<br>操作路径：' + html(page.navigation.join(' → ') || '大厅') + '</code></details><span>' + row.variants.length +
        ' 个版本</span></div></article>';
    }

    function renderGallery() {
      const restoreFocus = Boolean(document.activeElement.closest?.('#gallery-sections article'));
      byId('gallery-sections').innerHTML = Object.entries(moduleNames).map(([group, name]) => {
        const groupRows = rows.filter(row => row.group === group);
        if (!groupRows.length) return '';
        const total = new Set(matched.filter(page => page.group === group).map(page => page.key)).size;
        return '<section class="module-section" data-group="' + group + '" aria-labelledby="module-' + group + '">' +
          '<div class="module-heading"><h2 id="module-' + group + '">' + name + '</h2><span>' + total +
          ' 个页面</span></div><div class="cards">' + groupRows.map(cardMarkup).join('') + '</div></section>';
      }).join('');
      byId('gallery').classList.toggle('comparison', ['languages', 'devices'].includes(byId('view-mode').value));
      byId('gallery').style.setProperty('--preview-height', byId('thumbnail-size').value + 'px');
      const total = new Set(matched.map(page => page.key)).size;
      byId('count').textContent = total + ' 个页面 · ' + matched.length + ' 张截图';
      byId('empty').hidden = rows.length !== 0;
      byId('view-hint').textContent = {
        pages: '同一页面只显示一张图，下方可切换版本',
        languages: byId('locale').value ? '选择「全部语言」可并排对照不同语言' : '同一个页面，不同语言放在一起看',
        devices: byId('device').value || byId('resolution').value ? '选择「全部设备 / 分辨率」可并排对照' : '同一个页面，手机和电脑放在一起看',
        screenshots: '每种语言、每种设备都单独显示一张图',
      }[byId('view-mode').value];
      saveState();
      syncGallerySelection(restoreFocus);
    }

    function updateGallery() {
      const terms = byId('filter').value.trim().split(/[\s,，]+/).filter(Boolean).map(normalize);
      const candidates = galleryRecords.filter(page => matches(page, terms));
      moduleButtons.forEach(button => {
        const group = button.dataset.module;
        const count = new Set(candidates.filter(page => !group || page.group === group).map(page => page.key)).size;
        button.querySelector('.module-total').textContent = count;
        button.setAttribute('aria-pressed', String(group === selectedModule));
        button.tabIndex = group === selectedModule ? 0 : -1;
      });
      matched = candidates.filter(page => !selectedModule || page.group === selectedModule);
      rows = buildRows(matched);
      renderGallery();
      if (window.scrollY > byId('gallery').offsetTop) byId('gallery').scrollIntoView({ block: 'start' });
    }

    function resetFilters() {
      fields.forEach(id => { byId(id).value = defaults[id] || ''; });
      selectedModule = '';
      selectedVariants.clear();
      updateGallery();
    }
    moduleButtons.forEach(button => button.addEventListener('click', () => {
      selectedModule = button.dataset.module;
      updateGallery();
    }));
    byId('filter').addEventListener('input', () => updateGallery());
    fields.filter(id => id !== 'filter').forEach(id => byId(id).addEventListener('change', () => updateGallery()));
    byId('reset-filters').addEventListener('click', resetFilters);
    byId('empty-reset').addEventListener('click', () => { resetFilters(); byId('filter').focus(); });
    byId('toggle-filters').addEventListener('click', () => {
      const open = byId('gallery').querySelector('.toolbar').classList.toggle('filters-open');
      byId('toggle-filters').setAttribute('aria-expanded', String(open));
    });
    byId('gallery-sections').addEventListener('change', event => {
      if (!event.target.matches('.variant-select')) return;
      const card = event.target.closest('article'), page = galleryRecords[Number(event.target.value)];
      selectedVariants.set(card.dataset.row, page.id);
      card.dataset.label = page.label;
      card.querySelector('.variants').innerHTML = snapshotMarkup(page);
      syncGallerySelection();
    });
    byId('gallery-sections').addEventListener('error', event => {
      if (event.target.tagName !== 'IMG') return;
      const link = event.target.closest('.snapshot-link');
      event.target.hidden = true;
      const hint = document.createElement('span');
      hint.className = 'image-error';
      hint.textContent = '预览加载失败，点击查看原图';
      link.append(hint);
    }, true);
    window.addEventListener('hashchange', () => { readState(); updateGallery(); });
` + galleryKeyboardScript + String.raw`
    readState();
    updateGallery();
`;
