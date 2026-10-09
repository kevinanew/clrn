import { readFileSync } from 'node:fs';
import path from 'node:path';
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

export const galleryKeyboardScript = readFileSync(path.join(__dirname, 'snapshot-gallery-keyboard-browser.js'), 'utf8');
