export const viewerStyles = `
    #viewer { width: calc(100% - 24px); height: calc(100% - 24px); max-width: none; max-height: none; padding: 0; border: 1px solid #394454; border-radius: 10px; background: #111820; color: #f1f5f9; overflow: hidden; }
    #viewer::backdrop { background: rgb(8 13 20 / 85%); }
    #viewer kbd { display: inline-block; padding: 1px 5px; border: 1px solid #617087; border-radius: 4px; background: #19232f; color: #d5e1f0; font: 11px/1.4 ui-monospace, monospace; white-space: nowrap; }
    .viewer-shell { display: flex; flex-direction: column; height: 100%; }
    .viewer-header { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #394454; }
    .viewer-heading { flex: 1; min-width: 0; }
    #viewer-title { font-size: 15px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #viewer-position { color: #b8c6d6; font-size: 12px; margin: 2px 0 0; }
    .viewer-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    #viewer button, #viewer a { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 40px; min-height: 40px; padding: 6px 10px; border: 1px solid #526171; border-radius: 6px; background: #202c3a; color: #f1f5f9; font-size: 13px; text-decoration: none; }
    #viewer button:hover, #viewer a:hover { background: #334459; }
    #viewer button:disabled { opacity: .4; cursor: default; }
    #viewer button[aria-pressed="true"] { background: #1558a8; border-color: #78b8ff; }
    #viewer-zoom { min-width: 48px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
    .viewer-variants { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 6px 14px; border-bottom: 1px solid #394454; }
    .viewer-variants label { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #b8c6d6; font-size: 12px; }
    .viewer-variants select { min-height: 34px; padding: 4px 6px; background: #202c3a; color: #f1f5f9; border-color: #526171; max-width: 100%; }
    #viewer-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: none; user-select: none; outline-offset: -3px; }
    #viewer-image { position: absolute; top: 50%; left: 50%; width: auto; max-width: none; max-height: none; object-fit: initial; background: none; transform-origin: center; pointer-events: none; }
    #viewer-stage[data-draggable="true"] { cursor: grab; }
    #viewer-stage[data-dragging="true"] { cursor: grabbing; }
    #viewer .viewer-side { position: absolute; top: 50%; transform: translateY(-50%); z-index: 1; flex-direction: column; gap: 5px; width: 54px; min-height: 70px; padding: 6px; background: rgb(32 44 58 / 85%); }
    #viewer-prev { left: 8px; }
    #viewer-next { right: 8px; }
    #viewer-message { position: absolute; inset: 0; display: grid; place-content: center; margin: 0; color: #b8c6d6; text-align: center; padding: 24px 68px; }
    .viewer-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 14px; border-top: 1px solid #394454; }
    .viewer-info { flex: 1; min-width: 180px; }
    #viewer-meta, .viewer-help { font-size: 12px; color: #b8c6d6; margin: 0; }
    .viewer-help { margin-top: 3px; }
    #viewer-shortcuts { position: relative; font-size: 12px; }
    #viewer-shortcuts summary { min-height: 40px; padding: 10px 8px; cursor: pointer; }
    .shortcut-panel { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 3; width: min(430px, calc(100vw - 40px)); max-height: 60dvh; overflow: auto; padding: 14px; border: 1px solid #526171; border-radius: 8px; background: #202c3a; box-shadow: 0 8px 30px #0008; }
    .shortcut-panel h3 { margin: 0 0 8px; font-size: 14px; }
    .shortcut-panel dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; }
    .shortcut-panel dd { margin: 0; }
    @media (max-width: 760px) {
      #viewer { width: 100%; height: 100%; height: 100dvh; border: 0; border-radius: 0; }
      .viewer-header { padding: 6px 8px; gap: 6px; }
      .viewer-heading { flex-basis: calc(100% - 106px); }
      .viewer-view-modes { order: 1; width: 100%; }
      #viewer button, #viewer a { padding: 6px 8px; font-size: 12px; }
      .viewer-variants { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); padding: 6px 8px; gap: 8px; }
      .viewer-variants label { display: grid; grid-template-columns: auto 1fr; gap: 2px 4px; font-size: 11px; }
      .viewer-variants kbd { justify-self: start; }
      .viewer-variants select { grid-column: 1 / -1; min-width: 0; width: 100%; font-size: 12px; }
      .shortcut-panel { position: fixed; right: 12px; bottom: 96px; width: calc(100vw - 24px); }
      .viewer-footer { padding: 6px 8px; gap: 6px; }
      .viewer-info { flex-basis: 100%; min-width: 0; }
      .viewer-help { display: none; }
      #viewer .viewer-side { width: 44px; min-height: 60px; font-size: 11px; }
      #viewer-prev { left: 4px; }
      #viewer-next { right: 4px; }
    }
`;

export const viewerMarkup = `
  <dialog id="viewer" aria-labelledby="viewer-title" aria-describedby="viewer-position">
    <div class="viewer-shell">
      <div class="viewer-header">
        <div class="viewer-heading"><h2 id="viewer-title"></h2><p id="viewer-position" aria-live="polite"></p></div>
        <div class="viewer-actions viewer-view-modes" role="group" aria-label="图片显示方式">
          <button id="viewer-fit" type="button" aria-label="适应窗口" aria-pressed="true" title="完整显示图片（0）">整张看 <kbd aria-hidden="true">0</kbd></button>
          <button id="viewer-actual" type="button" aria-label="1:1" aria-pressed="false" title="按原始像素显示（1）">原始大小 <kbd aria-hidden="true">1</kbd></button>
          <button id="viewer-width" type="button" aria-label="按宽度显示" aria-pressed="false" title="按窗口宽度显示，从顶部开始看（2）">按宽度看 <kbd aria-hidden="true">2</kbd></button>
        </div>
        <button id="viewer-close" type="button" aria-label="关闭" title="关闭（Esc）">关闭 <kbd aria-hidden="true">Esc</kbd></button>
      </div>
      <div class="viewer-variants" role="group" aria-label="同一页面的其他版本">
        <label>语言 <kbd aria-hidden="true">L</kbd><select id="viewer-locale" aria-label="大图语言" title="L 换下一种语言，Shift + L 换上一种"></select></label>
        <label>设备 <kbd aria-hidden="true">V</kbd><select id="viewer-viewport" aria-label="大图设备与分辨率" title="V 换下一种设备或分辨率，Shift + V 换上一种"></select></label>
      </div>
      <div id="viewer-stage" tabindex="0" role="region" aria-label="截图浏览区域" aria-describedby="viewer-keyboard-hint">
        <img id="viewer-image" alt="" draggable="false" hidden>
        <p id="viewer-message" aria-live="polite">正在加载图片…</p>
        <button id="viewer-prev" class="viewer-side" type="button" aria-label="上一张" title="上一张（←）">上一张 <kbd aria-hidden="true">←</kbd></button>
        <button id="viewer-next" class="viewer-side" type="button" aria-label="下一张" title="下一张（→）">下一张 <kbd aria-hidden="true">→</kbd></button>
      </div>
      <div class="viewer-footer">
        <div class="viewer-info">
          <p id="viewer-meta"></p>
          <p id="viewer-keyboard-hint" class="viewer-help"><kbd>↑ ↓</kbd> 上下移动 · <kbd>Shift + ← →</kbd> 左右移动 · 滚轮上下看图 · Ctrl/⌘＋滚轮缩放</p>
        </div>
        <div class="viewer-actions" role="group" aria-label="缩放图片">
          <button id="viewer-out" type="button" aria-label="缩小" title="缩小（-）">缩小 <kbd aria-hidden="true">−</kbd></button>
          <span id="viewer-zoom" aria-live="polite">100%</span>
          <button id="viewer-in" type="button" aria-label="放大" title="放大（+ 或 =）">放大 <kbd aria-hidden="true">+</kbd></button>
        </div>
        <div class="viewer-actions">
          <a id="viewer-original" aria-label="打开原图" title="打开原图（O）" target="_blank" rel="noopener">原图 <kbd aria-hidden="true">O</kbd></a>
          <a id="viewer-download" aria-label="下载" title="下载（D）" download>下载 <kbd aria-hidden="true">D</kbd></a>
          <details id="viewer-shortcuts"><summary>快捷键 <kbd>?</kbd></summary><div class="shortcut-panel">
            <h3>看图快捷键</h3><dl>
              <dt>上一张 / 下一张</dt><dd><kbd>←</kbd> / <kbd>→</kbd></dd>
              <dt>放大 / 缩小</dt><dd><kbd>+</kbd> 或 <kbd>=</kbd> / <kbd>−</kbd></dd>
              <dt>整张 / 原始大小 / 按宽度</dt><dd><kbd>0</kbd> / <kbd>1</kbd> / <kbd>2</kbd></dd>
              <dt>上下移动图片</dt><dd><kbd>↑</kbd> / <kbd>↓</kbd> 或滚轮</dd>
              <dt>左右移动图片</dt><dd><kbd>Shift + ←</kbd> / <kbd>Shift + →</kbd></dd>
              <dt>向上 / 向下移动一屏</dt><dd><kbd>PageUp</kbd> / <kbd>PageDown</kbd></dd>
              <dt>图片顶部 / 底部</dt><dd><kbd>Home</kbd> / <kbd>End</kbd></dd>
              <dt>下一种 / 上一种语言</dt><dd><kbd>L</kbd> / <kbd>Shift + L</kbd></dd>
              <dt>下一个 / 上一个设备或尺寸</dt><dd><kbd>V</kbd> / <kbd>Shift + V</kbd></dd>
              <dt>打开原图 / 下载</dt><dd><kbd>O</kbd> / <kbd>D</kbd></dd>
              <dt>查看 / 收起快捷键</dt><dd><kbd>?</kbd>（Shift + /）</dd>
              <dt>关闭 / 切换控件</dt><dd><kbd>Esc</kbd> / <kbd>Tab</kbd>、<kbd>Shift + Tab</kbd></dd>
            </dl>
          </div></details>
        </div>
      </div>
    </div>
  </dialog>
`;
