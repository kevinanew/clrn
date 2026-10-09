import type { GalleryPage } from './snapshot-gallery-model';
import { escapeHtml, LOCALE_NAMES, MODULE_NAMES, pageKey } from './snapshot-gallery-model';
import { galleryKeyboardMarkup } from './snapshot-gallery-keyboard';
import { galleryStyles } from './snapshot-gallery-styles';
import { galleryScript } from './snapshot-gallery-script';
import { viewerMarkup, viewerScript, viewerStyles } from './snapshot-gallery-viewer';

/**
 * 所有数据与交互内嵌，直接用 file:// 打开即可筛选、对照和连续浏览。
 * @param pages - 要展示的截图元数据，包含所有语言和设备版本。
 */
export function renderSnapshotGallery(pages: GalleryPage[]): string {
  const modules = Object.entries(MODULE_NAMES).filter(([group]) => pages.some(page => page.group === group));
  const locales = [...new Set(pages.map(page => page.locale))];
  const resolutions = [...new Set(pages.map(page => `${page.viewport.width}x${page.viewport.height}`))];
  const pageCount = new Set(pages.map(pageKey)).size;
  const records = JSON.stringify(pages.map(({ label, page, group, locale, viewport, signedIn, navigation, file }) =>
    ({ label, page, group, locale, viewport, signedIn, navigation, file }))).replace(/</g, '\\u003c');
  /**
   * 生成带可读名称的安全筛选下拉选项。
   * @param values - 下拉框候选值。
   * @param label - 将候选值转换为可读标题的函数。
   */
  const options = (values: string[], label: (value: string) => string) => values.map(value =>
    `<option value="${escapeHtml(value)}">${escapeHtml(label(value))}</option>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>来玩 H5 页面截图索引</title>
  <style>${galleryStyles}\n${viewerStyles}</style>
</head>
<body>
  <header class="page-header">
    <h1>来玩 H5 截图</h1>
    <span class="overview">${pageCount} 个页面 · ${pages.length} 张截图 · ${modules.length} 个模块</span>
    <details id="gallery-about" class="about"><summary aria-keyshortcuts="B">截图说明 <kbd aria-hidden="true">B</kbd></summary><div>
      <p><a id="manifest-link" href="manifest.json" target="_blank" rel="noopener" aria-keyshortcuts="P">页面清单与 SHA-256 <kbd aria-hidden="true">P</kbd></a></p>
      <p>截图中的易变文本使用固定值；德州场景会真实建房并在截图后解散。</p>
      <p>同一页面的不同语言、不同设备放在一起。点击截图放大，支持缩放、拖动和方向键切图。</p>
    </div></details>
    <button id="gallery-help" type="button" aria-label="查看快捷键说明" aria-keyshortcuts="Shift+/" aria-haspopup="dialog">快捷键 <kbd aria-hidden="true">?</kbd></button>
  </header>
  <div class="layout">
    <nav aria-label="功能模块">
      <h2>功能模块 <kbd aria-hidden="true">M</kbd> <kbd aria-hidden="true">[ ]</kbd></h2>
      <div class="module-buttons">
        <button class="module-button" type="button" data-module="" aria-pressed="true" aria-controls="gallery">全部模块 <span class="module-total">${pageCount}</span></button>
        ${modules.map(([group, name]) => `<button class="module-button" type="button" data-module="${group}" aria-pressed="false" aria-controls="gallery">${name} <span class="module-total"></span></button>`).join('\n')}
      </div>
      <p class="nav-help">↑ ↓ 选择 · Enter 确认<br>数字为匹配的页面数</p>
    </nav>
    <main id="gallery">
      <div class="toolbar">
        <div class="search-row">
          <label class="sr-only" for="filter">搜索截图</label>
          <div class="search-field"><kbd class="search-key" aria-hidden="true">/</kbd><input id="filter" type="search" placeholder="搜页面名称，比如：聊天、登录、战绩" aria-describedby="count" aria-keyshortcuts="/ Control+K Meta+K" title="/ 或 Ctrl/⌘ + K 搜索，Enter 回到结果，Esc 返回图片"></div>
          <button id="toggle-filters" type="button" aria-label="筛选与对照" aria-keyshortcuts="F" aria-expanded="false" aria-controls="filter-options">筛选 <kbd aria-hidden="true">F</kbd></button>
          <button id="reset-filters" class="quiet-button" type="button" aria-label="清除筛选" aria-keyshortcuts="X">清除筛选 <kbd aria-hidden="true">X</kbd></button>
        </div>
        <div id="filter-options" class="filter-options">
          <label>语言 <kbd aria-hidden="true">L</kbd><select id="locale" aria-keyshortcuts="L Shift+L" title="L 切换，Shift + L 反向切换"><option value="">全部语言</option>${options(locales, value => LOCALE_NAMES[value] || value)}</select></label>
          <label>设备 <kbd aria-hidden="true">V</kbd><select id="device" aria-keyshortcuts="V Shift+V" title="V 切换，Shift + V 反向切换"><option value="">全部设备</option><option value="mobile">手机</option><option value="desktop">电脑</option></select></label>
          <label>怎么看 <kbd aria-hidden="true">C</kbd><select id="view-mode" aria-keyshortcuts="C Shift+C" title="C 切换，Shift + C 反向切换"><option value="pages">每个页面一张图</option><option value="languages">对比不同语言</option><option value="devices">对比手机和电脑</option><option value="screenshots">查看全部截图</option></select></label>
          <details class="more-filters"><summary aria-keyshortcuts="E">更多筛选 <kbd aria-hidden="true">E</kbd></summary><div>
            <label>分辨率 <kbd aria-hidden="true">R</kbd><select id="resolution" aria-keyshortcuts="R Shift+R" title="R 切换，Shift + R 反向切换"><option value="">全部分辨率</option>${options(resolutions, value => value.replace('x', ' × '))}</select></label>
            <label>登录状态 <kbd aria-hidden="true">A</kbd><select id="auth" aria-keyshortcuts="A Shift+A" title="A 切换，Shift + A 反向切换"><option value="">全部状态</option><option value="signed-in">已登录</option><option value="guest">游客</option></select></label>
            <label>图片大小 <kbd aria-hidden="true">S</kbd><select id="thumbnail-size" aria-keyshortcuts="S Shift+S" title="S 切换，Shift + S 反向切换"><option value="220">小</option><option value="300" selected>中</option><option value="420">大</option></select></label>
          </div></details>
        </div>
        <div class="result-row"><p id="count" role="status" aria-live="polite"></p><span id="view-hint">同一页面只显示一张图，下方可切换版本</span></div>
        <div class="keyboard-guide"><span><kbd>← ↑ ↓ →</kbd> 选图 · <kbd>Enter</kbd> 放大 · <kbd>G</kbd> 回到图片 · <kbd>?</kbd> 所有快捷键</span><span id="gallery-selection" class="sr-only" aria-live="polite"></span></div>
      </div>
      <div id="empty" hidden><h2>没有匹配的截图</h2><p>试试其他关键词，或放宽语言、设备、分辨率筛选。</p><button id="empty-reset" type="button" aria-label="清除所有筛选" aria-keyshortcuts="X">清除所有筛选 <kbd aria-hidden="true">X</kbd></button></div>
      <div id="gallery-sections"></div>
      <noscript>请启用 JavaScript 使用筛选与预览，也可以打开 <a href="manifest.json">页面清单</a> 查看原图路径。</noscript>
    </main>
  </div>
  ${galleryKeyboardMarkup.trim()}
  ${viewerMarkup.trim()}
  <script id="gallery-data" type="application/json">${records}</script>
  <script>${galleryScript}\n${viewerScript}</script>
</body>
</html>\n`;
}
