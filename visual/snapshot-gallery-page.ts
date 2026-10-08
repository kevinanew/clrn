import type { LocaleCode, ScenarioGroup, ViewportDef } from './scenarioTypes';
import { viewerMarkup, viewerScript, viewerStyles } from './snapshot-gallery-viewer';

type GalleryPage = {
  label: string;
  group: ScenarioGroup;
  locale: LocaleCode;
  viewport: ViewportDef;
  signedIn: boolean;
  navigation: string[];
  file: string;
};

const MODULE_NAMES: Record<ScenarioGroup, string> = {
  hall: '大厅',
  auth: '登录与认证',
  message: '消息',
  'private-room': '私人房',
  'texas-holdem': '德州牌桌',
  club: '俱乐部',
  account: '个人账号',
  wallet: '钱包与记录',
  'game-record': '我的战绩',
  help: '帮助与下载',
};

const LOCALE_NAMES: Record<LocaleCode, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁体中文',
  en: '英文',
};

function escape(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, character => entities[character]);
}

function renderCard(page: GalleryPage): string {
  const locale = LOCALE_NAMES[page.locale];
  const viewport = page.viewport.label === 'mobile' ? '手机' : '桌面';
  const auth = page.signedIn ? '已登录' : '游客';
  const searchableText = `${page.label} ${MODULE_NAMES[page.group]} ${locale} ${viewport} ${auth}`;
  return `<article data-label="${escape(page.label)}" data-search="${escape(searchableText)}">
    <h3>${escape(page.label)}</h3>
    <p class="card-meta">${locale} · ${viewport} · ${auth} · ${page.viewport.width} × ${page.viewport.height}</p>
    <a class="snapshot-link" href="${escape(page.file)}" aria-label="查看截图 ${escape(page.label)}"><img loading="lazy" src="${escape(page.file)}" alt="${escape(page.label)} 页面截图"></a>
    <details><summary>查看页面入口</summary><code>${escape(page.navigation.join(' → ') || '大厅')}</code></details>
  </article>`;
}

/** 按模块生成索引；筛选脚本内嵌，使本地打开 HTML 时也能直接使用。 */
export function renderSnapshotGallery(pages: GalleryPage[]): string {
  const modules = Object.entries(MODULE_NAMES).map(([group, name]) => ({
    group,
    name,
    pages: pages.filter(page => page.group === group),
  })).filter(module => module.pages.length > 0);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>来玩 H5 页面截图索引</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f5f7; color: #17202a; font: 16px/1.5 system-ui; }
    header { padding: 28px 32px 20px; background: white; border-bottom: 1px solid #dfe3e9; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    header p { margin: 6px 0; }
    a { color: #1558a8; }
    .layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 28px; padding: 24px 32px; }
    nav { position: sticky; top: 24px; align-self: start; }
    nav h2 { margin: 0 0 12px; font-size: 16px; }
    .module-buttons { display: flex; flex-direction: column; gap: 6px; }
    button { font: inherit; cursor: pointer; }
    .module-button { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; text-align: left; }
    .module-button:hover { background: #e6ebf2; }
    .module-button[aria-pressed="true"] { background: #1558a8; color: white; }
    button:focus-visible, input:focus-visible, a:focus-visible { outline: 3px solid #4a90d9; outline-offset: 3px; }
    .module-total { font-size: 13px; align-self: center; }
    .toolbar label { display: block; font-weight: 600; margin-bottom: 8px; }
    input { width: min(100%, 680px); padding: 12px; border: 1px solid #acb8c7; border-radius: 6px; background: white; font: inherit; }
    #count { color: #526171; margin: 12px 0 24px; }
    .module-section { margin-bottom: 36px; }
    .module-heading { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
    .module-heading h2 { margin: 0; font-size: 22px; }
    .module-heading span { color: #526171; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr)); gap: 20px; }
    article { min-width: 0; background: white; padding: 16px; border: 1px solid #e2e6ed; border-radius: 8px; overflow-wrap: anywhere; }
    h3 { margin: 0; font-size: 14px; }
    .card-meta { color: #526171; font-size: 13px; margin: 8px 0 12px; }
    img { width: 100%; max-height: 680px; object-fit: contain; object-position: top; background: #eee; }
    details { margin-top: 10px; font-size: 13px; }
    summary { cursor: pointer; color: #1558a8; }
    code { display: block; margin-top: 8px; font-size: 12px; }
    [hidden] { display: none !important; }
    #empty { padding: 28px; background: white; border-radius: 8px; }
    .snapshot-link { display: block; cursor: zoom-in; }
    ${viewerStyles.trim()}
    @media (max-width: 760px) {
      header { padding: 20px 16px; }
      .layout { grid-template-columns: 1fr; padding: 16px; gap: 20px; }
      nav { position: static; }
      .module-buttons { flex-direction: row; flex-wrap: wrap; }
      .module-button { border-color: #dfe3e9; background: white; }
    }
  </style>
</head>
<body>
  <header>
    <h1>来玩 H5 页面截图索引</h1>
    <p>${pages.length} 张当前基准 · ${modules.length} 个模块 · <a href="manifest.json">页面清单与 SHA-256</a></p>
    <p>先选择功能模块，再搜索页面、语言或视口。点击截图放大查看，支持缩放、拖动和方向键切图。</p>
    <p>截图中的易变文本使用固定值；德州场景会真实建房并在截图后解散。</p>
  </header>
  <div class="layout">
    <nav aria-labelledby="module-navigation-title">
      <h2 id="module-navigation-title">功能模块</h2>
      <div class="module-buttons">
        <button class="module-button" type="button" data-module="" aria-pressed="true" aria-controls="gallery">全部模块 <span class="module-total">${pages.length}</span></button>
        ${modules.map(module => `<button class="module-button" type="button" data-module="${escape(module.group)}" aria-pressed="false" aria-controls="gallery">${module.name} <span class="module-total">${module.pages.length}</span></button>`).join('\n        ')}
      </div>
    </nav>
    <main id="gallery">
      <div class="toolbar">
        <label for="filter">搜索截图</label>
        <input id="filter" type="search" placeholder="例如：德州、mobile chat、zh-Hans" aria-describedby="count">
        <p id="count" role="status">显示 ${pages.length} 张 · ${modules.length} 个模块</p>
      </div>
      <p id="empty" hidden>没有匹配的截图，请调整模块或搜索词。</p>
      ${modules.map(module => `<section class="module-section" data-group="${escape(module.group)}" aria-labelledby="module-${escape(module.group)}">
        <div class="module-heading"><h2 id="module-${escape(module.group)}">${module.name}</h2><span data-module-count>${module.pages.length} 张</span></div>
        <div class="cards">${module.pages.map(renderCard).join('\n')}</div>
      </section>`).join('\n      ')}
    </main>
  </div>
  ${viewerMarkup.trim()}
  <script>
    const filter = document.querySelector('#filter');
    const sections = Array.from(document.querySelectorAll('.module-section'));
    const buttons = Array.from(document.querySelectorAll('[data-module]'));
    let selectedModule = '';

    function updateGallery() {
      const terms = filter.value.trim().toLowerCase().split(/[\\s,，]+/).filter(Boolean);
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
    ${viewerScript.trim()}
  </script>
</body>
</html>\n`;
}
