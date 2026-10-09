// 生成图库时嵌入同一脚本；跨文件引用的变量由 ESLint 配置显式声明。
/* exported byId, html, variantLabel, pageMeta, galleryRecords, moduleButtons, selectedModule, rows, readState, getGalleryItems, snapshotDetailsMarkup, setGalleryVariant, updateGallery, resetFilters */
/**
 * 按 ID 获取图库页面的控件。
 * @param id - 控件在 HTML 中的 ID。
 */
const byId = id => document.getElementById(id);
/**
 * 将场景名称转换为忽略大小写和分隔符的搜索文本。
 * @param value - 需要填入表单或转义的原始字符串。
 */
const normalize = value => value.toLowerCase().replace(/[_-]/g, ' ');
/**
 * 转义插入图库 HTML 的文字，避免名称被解析为标签。
 * @param value - 需要填入表单或转义的原始字符串。
 */
const html = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
/**
 * 生成语言、设备及分辨率的版本说明。
 * @param page - 待展示或分组的截图元数据。
 */
const variantLabel = page => (localeNames[page.locale] || page.locale) + ' · ' +
  (page.viewport.label === 'mobile' ? '手机' : '电脑') + ' · ' + page.viewport.width + ' × ' + page.viewport.height;
/**
 * 生成版本与登录状态的说明。
 * @param page - 待展示或分组的截图元数据。
 */
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

/** 从 URL 片段恢复筛选项，并在必要时展开筛选栏。 */
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

/** 将非默认筛选项写入 URL，供刷新或分享时恢复。 */
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
  try { history.replaceState(null, '', url.href); } catch { location.replace(url.href); }
}

/**
 * 判断截图是否同时满足版本筛选与所有搜索词。
 * @param page - 待展示或分组的截图元数据。
 * @param terms - 需要同时匹配的搜索词。
 */
function matches(page, terms) {
  return (!byId('locale').value || page.locale === byId('locale').value) &&
    (!byId('device').value || page.viewport.label === byId('device').value) &&
    (!byId('resolution').value || page.viewport.width + 'x' + page.viewport.height === byId('resolution').value) &&
    (!byId('auth').value || (page.signedIn ? 'signed-in' : 'guest') === byId('auth').value) &&
    terms.every(term => page.search.includes(term));
}

/**
 * 优先使用用户选择的版本，否则选择简体手机版本。
 * @param variants - 同一页面的候选版本。
 * @param key - 保存用户版本选择的截图分组键。
 */
function preferred(variants, key) {
  const selected = variants.find(page => page.id === selectedVariants.get(key));
  return selected || variants.slice().sort((a, b) =>
    (a.locale === 'zh-Hans' ? 0 : 2) + (a.viewport.label === 'mobile' ? 0 : 1) -
    (b.locale === 'zh-Hans' ? 0 : 2) - (b.viewport.label === 'mobile' ? 0 : 1))[0];
}

/**
 * 按页面、语言或设备的浏览模式组织截图行。
 * @param pages - 待处理的页面定义或截图元数据清单。
 */
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

/**
 * 取得当前浏览模式下该行需要展示的截图。
 * @param row - 已分组的截图行及其版本。
 */
function rowItems(row) {
  return byId('view-mode').value === 'pages' ? [preferred(row.variants, row.key)] : row.variants;
}
// 连续浏览当前筛选结果；图片由浏览器按需加载。
/** 按图库顺序返回当前可浏览的截图 ID。 */
function getGalleryItems() { return rows.flatMap(rowItems).map(page => page.id); }

/**
 * 生成单张截图的预览链接与版本说明。
 * @param page - 待展示或分组的截图元数据。
 * @param caption - 是否显示版本标题。
 */
function snapshotMarkup(page, caption = false) {
  return '<div class="snapshot-item" data-id="' + page.id + '" data-label="' + html(page.label) + '">' +
    (caption ? '<p class="variant-caption">' + html(variantLabel(page)) + '</p>' : '') +
    '<a class="snapshot-link" aria-keyshortcuts="Enter Space" href="' + html(page.file) + '" aria-label="查看截图 ' + html(page.label) + '">' +
    '<img loading="lazy" decoding="async" src="' + html(page.file) + '" alt="' + html(page.label) + ' 页面截图"></a>' +
    '<p class="card-meta">' + html(pageMeta(page)) + '</p></div>';
}

/**
 * 生成截图原始名称和操作路径的详情。
 * @param page - 待展示或分组的截图元数据。
 */
function snapshotDetailsMarkup(page) {
  return '原始名称：' + html(page.label) + '<br>操作路径：' + html(page.navigation.join(' → ') || '大厅');
}

/**
 * 切换卡片展示的版本并同步键盘选择。
 * @param card - 当前截图所在的卡片元素。
 * @param page - 待展示或分组的截图元数据。
 */
function setGalleryVariant(card, page) {
  selectedVariants.set(card.dataset.row, page.id);
  card.dataset.label = page.label;
  const select = card.querySelector('.variant-select');
  if (select) select.value = String(page.id);
  card.querySelector('.variants').innerHTML = snapshotMarkup(page);
  syncGallerySelection();
}

/**
 * 生成包含版本选择与详情的截图卡片。
 * @param row - 已分组的截图行及其版本。
 */
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
    snapshotDetailsMarkup(page) + '</code></details><span>' + row.variants.length +
    ' 个版本</span></div></article>';
}

/** 绘制模块分组和计数，保存筛选并恢复键盘选择。 */
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

/** 根据模块与搜索词筛选截图卡片，更新各模块计数和空结果提示。 */
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

/** 恢复默认筛选，清除版本选择并重新绘制图库。 */
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
  setGalleryVariant(card, page);
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
