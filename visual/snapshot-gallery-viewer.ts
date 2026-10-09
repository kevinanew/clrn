import { readFileSync } from 'node:fs';
import path from 'node:path';

// 内嵌到生成的 HTML，保证 file:// 打开时无需服务器或额外脚本。
export const viewerStyles = `
    #viewer { width: calc(100% - 32px); height: calc(100% - 32px); max-width: none; max-height: none; padding: 0; border: 1px solid #394454; border-radius: 12px; background: #111820; color: #f1f5f9; overflow: hidden; }
    #viewer::backdrop { background: rgb(8 13 20 / 85%); }
    .viewer-shell { display: flex; flex-direction: column; height: 100%; }
    .viewer-header { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #394454; }
    .viewer-heading { flex: 1; min-width: 0; }
    #viewer-title { font-size: 14px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #viewer-position { color: #b8c6d6; font-size: 12px; margin: 3px 0 0; }
    .viewer-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    #viewer button, #viewer a { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 8px 12px; border: 1px solid #526171; border-radius: 6px; background: #202c3a; color: #f1f5f9; font-size: 13px; text-decoration: none; }
    #viewer button:hover, #viewer a:hover { background: #334459; }
    #viewer button:disabled { opacity: .4; cursor: default; }
    #viewer button[aria-pressed="true"] { background: #1558a8; border-color: #78b8ff; }
    #viewer-zoom { min-width: 50px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
    #viewer-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: none; user-select: none; }
    #viewer-image { position: absolute; top: 50%; left: 50%; width: auto; max-width: none; max-height: none; object-fit: initial; background: none; transform-origin: center; pointer-events: none; }
    #viewer-stage[data-draggable="true"] { cursor: grab; }
    #viewer-stage[data-dragging="true"] { cursor: grabbing; }
    #viewer-message { position: absolute; inset: 0; display: grid; place-content: center; margin: 0; color: #b8c6d6; text-align: center; padding: 24px; }
    .viewer-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid #394454; }
    #viewer-meta, .viewer-help { font-size: 12px; color: #b8c6d6; margin: 0; }
    .viewer-help { margin-top: 3px; }
    @media (max-width: 760px) {
      #viewer { width: 100%; height: 100%; height: 100dvh; border: 0; border-radius: 0; }
      .viewer-header { padding: 8px; gap: 8px; }
      .viewer-heading { flex-basis: calc(100% - 72px); }
      .viewer-actions { order: 1; width: 100%; gap: 4px; justify-content: center; }
      #viewer button, #viewer a { padding: 8px; }
      .viewer-footer { padding: 8px; flex-wrap: wrap; gap: 6px; }
      .viewer-help { display: none; }
    }
`;

export const viewerMarkup = `
  <dialog id="viewer" aria-labelledby="viewer-title" aria-describedby="viewer-position">
    <div class="viewer-shell">
      <div class="viewer-header">
        <div class="viewer-heading">
          <h2 id="viewer-title"></h2>
          <p id="viewer-position" aria-live="polite"></p>
        </div>
        <div class="viewer-actions" role="group" aria-label="图片操作">
          <button id="viewer-prev" type="button" title="上一张（←）">上一张</button>
          <button id="viewer-next" type="button" title="下一张（→）">下一张</button>
          <button id="viewer-out" type="button" aria-label="缩小" title="缩小（-）">−</button>
          <span id="viewer-zoom" aria-live="polite">100%</span>
          <button id="viewer-in" type="button" aria-label="放大" title="放大（+）">+</button>
          <button id="viewer-fit" type="button" aria-pressed="true" title="完整显示图片（0）">适应窗口</button>
          <button id="viewer-actual" type="button" aria-pressed="false" title="按原始像素显示（1）">1:1</button>
        </div>
        <button id="viewer-close" type="button" title="关闭（Esc）" autofocus>关闭</button>
      </div>
      <div id="viewer-stage">
        <img id="viewer-image" alt="" draggable="false" hidden>
        <p id="viewer-message" aria-live="polite">正在加载图片…</p>
      </div>
      <div class="viewer-footer">
        <div>
          <p id="viewer-meta"></p>
          <p class="viewer-help">滚轮缩放 · 放大后拖动 · 双击切换原始大小 · ← → 切图 · Esc 关闭</p>
        </div>
        <div class="viewer-actions">
          <a id="viewer-original" target="_blank" rel="noopener">打开原图</a>
          <a id="viewer-download" download>下载</a>
        </div>
      </div>
    </div>
  </dialog>
`;

// 独立 JavaScript 源文件由全仓库 ESLint 检查，生成 HTML 时仍内嵌以支持离线浏览。
export const galleryScript = readFileSync(path.join(__dirname, 'snapshot-gallery-browser.js'), 'utf8');
