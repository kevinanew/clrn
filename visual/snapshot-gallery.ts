import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildScenarios } from './scenarios';
import { visualBaseUrl } from './target';

// 与测试使用同一份场景清单，历史废弃截图不冒充当前覆盖。
const scenarios = buildScenarios();
const directory = path.join(__dirname, 'snapshots');
// Playwright 对 snapshot 参数中的下划线进行文件名清洗。
const filename = (label: string) => `${label.replace(/_/g, '-')}.png`;
const missing = scenarios.filter(scenario => !existsSync(path.join(directory, filename(scenario.label))));
if (missing.length) {
  throw new Error(`缺少 ${missing.length} 张基准图，请先完成 reference：\n${missing.map(s => s.label).join('\n')}`);
}
const pages = scenarios.map(scenario => {
  const file = filename(scenario.label);
  return {
    label: scenario.label,
    page: scenario.pageLabel,
    locale: scenario.locale,
    viewport: scenario.viewport,
    signedIn: scenario.signIn,
    navigation: [scenario.tabTestId, ...scenario.navClickTestIds].filter(Boolean),
    readySelector: scenario.visualReadySelector,
    fixedTexts: scenario.fixedTexts,
    hiddenSelectors: scenario.hideSelectors,
    file,
    sha256: createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex'),
  };
});
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
  baseUrl: visualBaseUrl,
  scope: process.env.VISUAL_SCOPE || 'full',
  note: 'Linux 视觉基准清单。使用固定文本与视觉接口 fixtures，不代表真实业务提交通过；生成清单不会更新或批准截图。',
  count: pages.length,
  pages,
}, null, 2) + '\n');
writeFileSync(path.join(directory, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>来玩 H5 页面截图索引</title>
<style>
body{font:16px system-ui;margin:24px;background:#f4f5f7;color:#17202a}input{padding:12px;width:min(90%,600px)}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-top:24px}
article{background:white;padding:16px;border-radius:8px;overflow-wrap:anywhere}article[hidden]{display:none}
img{width:100%;max-height:680px;object-fit:contain;object-position:top;background:#eee}h2{font-size:15px}
a{color:#1558a8}small{display:block;margin:8px 0}code{font-size:12px}
</style>
<h1>来玩 H5 页面截图索引</h1>
<p>${pages.length} 张当前基准 · <a href="manifest.json">页面清单与 SHA-256</a></p>
<p>截图使用固定数据用于视觉回归；真实业务验证范围见 e2e/cases/COVERAGE.md。历史废弃截图不计入清单。</p>
<label>筛选页面、语言或视口 <input id="filter" type="search" placeholder="例如 mobile、login、club"></label>
<p id="count" role="status">显示 ${pages.length} 张</p>
<main>${pages.map(page => `<article data-label="${escape(page.label)}">
<h2>${escape(page.label)}</h2><small>${page.signedIn ? '已登录' : '游客'} · ${page.viewport.width} × ${page.viewport.height}</small>
<a href="${escape(page.file)}"><img loading="lazy" src="${escape(page.file)}" alt="${escape(page.label)} 页面截图"></a>
<small>入口：<code>${escape(page.navigation.join(' → ') || '大厅')}</code></small></article>`).join('\n')}</main>
<script>document.querySelector('#filter').addEventListener('input',event=>{
const query=event.target.value.trim().toLowerCase();let count=0;
document.querySelectorAll('article').forEach(card=>{card.hidden=!card.dataset.label.toLowerCase().includes(query);if(!card.hidden)count++});
document.querySelector('#count').textContent='显示 '+count+' 张';});</script></html>\n`);
console.log(`已生成 ${pages.length} 张截图的索引：snapshots/index.html`);
