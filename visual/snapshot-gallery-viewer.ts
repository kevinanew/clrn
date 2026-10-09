import { readFileSync } from 'node:fs';
import path from 'node:path';
// 内嵌到生成的 HTML，保证 file:// 打开时无需服务器或额外脚本。
export { viewerStyles, viewerMarkup } from './snapshot-gallery-viewer-ui';

export const viewerScript = readFileSync(path.join(__dirname, 'snapshot-gallery-viewer-browser.js'), 'utf8');
