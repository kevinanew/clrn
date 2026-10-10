const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.COMPARISON_SHARP_PATH || path.resolve(__dirname, '../../../../laiwan_react_native/node_modules/sharp'));
const directory = __dirname;

/**
 * 将真实截图嵌入离线页面，分享时无需附带其他文件。
 * @param filename - 对比目录内的截图相对路径。
 */
function imageData(filename) {
  return `data:image/png;base64,${readFileSync(path.join(directory, filename)).toString('base64')}`;
}

/** 对同一视口的原始截图逐像素比较，另生成底池区域的放大素材。 */
async function main() {
  const measurements = JSON.parse(readFileSync(path.join(directory, 'measurements.json'), 'utf8'));
  const provenance = JSON.parse(readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
  const scenes = [];
  mkdirSync(path.join(directory, 'details'), { recursive: true });
  for (const device of ['mobile', 'desktop']) {
    for (const state of ['full-table-full-pots', 'full-table-two-pots']) {
      const filename = `zh-Hans-${device}-${state}.png`;
      const current = measurements.find(item => item.version === 'current' && item.filename === filename);
      const previous = measurements.find(item => item.version === 'previous' && item.filename === filename);
      if (!current || !previous) throw new Error(`尚未完成两版采集：${filename}`);
      const rectangle = { left: Math.max(0, Math.floor(Math.min(current.geometry.container.x, previous.geometry.container.x)) - 12),
        top: Math.max(0, Math.floor(Math.min(current.geometry.container.y, previous.geometry.container.y)) - 12),
        width: 260, height: Math.ceil(Math.max(current.geometry.container.height, previous.geometry.container.height)) + 36 };
      const before = await sharp(path.join(directory, 'previous', filename)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const after = await sharp(path.join(directory, 'current', filename)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const difference = Buffer.alloc(after.data.length);
      let changedPixels = 0;
      let changedPotPixels = 0;
      for (let offset = 0; offset < after.data.length; offset += 4) {
        const changed = before.data[offset] !== after.data[offset] || before.data[offset + 1] !== after.data[offset + 1] || before.data[offset + 2] !== after.data[offset + 2];
        const pixel = offset / 4;
        const horizontal = pixel % after.info.width;
        const vertical = Math.floor(pixel / after.info.width);
        if (changed) {
          changedPixels += 1;
          if (horizontal >= rectangle.left && horizontal < rectangle.left + rectangle.width && vertical >= rectangle.top && vertical < rectangle.top + rectangle.height) changedPotPixels += 1;
        }
        difference[offset] = changed ? 238 : Math.round(after.data[offset] * 0.35);
        difference[offset + 1] = changed ? 70 : Math.round(after.data[offset + 1] * 0.35);
        difference[offset + 2] = changed ? 97 : Math.round(after.data[offset + 2] * 0.35);
        difference[offset + 3] = 255;
      }
      const differenceFilename = `details/${device}-${state}-difference.png`;
      await sharp(difference, { raw: after.info }).png().toFile(path.join(directory, differenceFilename));
      for (const version of ['previous', 'current']) {
        await sharp(path.join(directory, version, filename)).extract(rectangle).resize({ width: 780, kernel: 'nearest' }).png()
          .toFile(path.join(directory, `details/${device}-${state}-${version}.png`));
      }
      await sharp(path.join(directory, differenceFilename)).extract(rectangle).resize({ width: 780, kernel: 'nearest' }).png()
        .toFile(path.join(directory, `details/${device}-${state}-difference-detail.png`));
      const previousRows = [...new Set(previous.geometry.pots.map(item => item.y))].length;
      const currentRows = [...new Set(current.geometry.pots.map(item => item.y))].length;
      scenes.push({ device, state, filename, previousRows, currentRows, previousHeight: previous.geometry.container.height,
        currentHeight: current.geometry.container.height, changedPixels, changedPotPixels,
        changedPixelRatio: changedPixels / (after.info.width * after.info.height),
        images: { previous: imageData(`previous/${filename}`), current: imageData(`current/${filename}`), difference: imageData(differenceFilename),
          previousDetail: imageData(`details/${device}-${state}-previous.png`), currentDetail: imageData(`details/${device}-${state}-current.png`),
          differenceDetail: imageData(`details/${device}-${state}-difference-detail.png`) } });
    }
  }
  const statistics = scenes.map(scene => Object.fromEntries(Object.entries(scene).filter(([name]) => name !== 'images')));
  writeFileSync(path.join(directory, 'differences.json'), JSON.stringify(statistics, null, 2));
  const originalBaseline = readFileSync(path.resolve(directory, '../../cases/texas-holdem/snapshots/zh-Hans-mobile-signed-in-texas-table-states-full-table.png')).toString('base64');
  const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>九人满桌、九个底池：修改前后截图对比</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f4;color:#1c342c;font:16px/1.6 system-ui,-apple-system,sans-serif}main{max-width:1380px;margin:auto;padding:36px 28px}h1{font-size:30px;line-height:1.3;margin:0 0 12px}p{margin:8px 0}.muted{color:#587068;font-size:14px}.notice{background:#fff1d7;border:1px solid #e5ce9e;border-radius:12px;padding:14px 18px;margin:18px 0}nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}label{display:flex;align-items:center;gap:8px}select,button,a.download{font:inherit;border:1px solid #c5d1cb;border-radius:8px;padding:8px 12px;background:white;color:#193d30}button{cursor:pointer}button[aria-pressed=true]{background:#205a44;color:#fff}.summary{font-weight:650;margin:18px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{background:white;border-radius:14px;padding:18px;min-width:0}.panel h2{font-size:20px;margin:0 0 12px}.panel img{display:block;width:100%;height:auto;border-radius:8px}.panel img.phone{max-width:375px;margin:auto}#differencePanel{display:none;margin-top:20px}details{background:#fff;border-radius:12px;padding:14px 18px;margin-top:24px}summary{cursor:pointer;font-weight:600}code{overflow-wrap:anywhere}a{color:#226548}.baseline img{max-width:280px;display:block;margin:15px 0}footer{margin:30px 0 0;font-size:14px;color:#587068}.download{display:inline-block;text-decoration:none;margin-top:12px}#differencePanel img{width:100%;max-width:850px}.tools{display:flex;gap:8px}.sources{font-size:14px}@media(max-width:700px){main{padding:24px 16px}.grid{gap:10px}.panel{padding:10px}.panel h2{font-size:16px}h1{font-size:25px}}
</style><main><h1>九人满桌 · 九个底池</h1><p><strong>结论：两版底池均为两列五行，位置、金额和容器高度一致。</strong></p><p>差异图中底池区域的变化主要集中在圆角边缘；没有出现底池缺失或换行变化。整图另有头像和文字边缘的像素差异。</p><p class="muted">9 名玩家 · 底池 90 / 80 / 70 / 60 / 50 / 40 / 30 / 20 / 10 · 合计 450 · 手机与桌面</p>
<div class="notice">本批为 macOS Chromium 审阅截图。Docker 服务无响应，尚未生成或批准正式 Linux 基准，也未把此场景加入现有持续集成截图矩阵。</div>
<nav><label>设备 <select id="device"><option value="mobile">手机 375 × 812</option><option value="desktop">桌面 1440 × 900</option></select></label><label>场景 <select id="state"><option value="full-table-full-pots">九人满桌 / 九个底池</option><option value="full-table-two-pots">九人满桌 / 两个底池（已有覆盖的参照）</option></select></label><div class="tools"><button id="whole" aria-pressed="true">整桌截图</button><button id="detail" aria-pressed="false">底池放大</button><button id="difference" aria-pressed="false">显示差异</button></div></nav>
<p class="summary" id="summary"></p><div class="grid"><article class="panel"><h2>修改前 <small class="muted">FlatList</small></h2><img id="previousImage" alt="修改前牌桌截图"><a id="previousDownload" class="download" download>下载修改前原图</a></article><article class="panel"><h2>当前 <small class="muted">View + 换行</small></h2><img id="currentImage" alt="当前牌桌截图"><a id="currentDownload" class="download" download>下载当前原图</a></article></div>
<article class="panel" id="differencePanel"><h2>像素差异</h2><p class="muted">粉红色标出不同的像素。底池放大模式便于隔离目标变化；整图也可能包含头像、倒计时等采集噪声。</p><img id="differenceImage" alt="不同像素以粉红色标出"></article>
<details class="baseline"><summary>原 clrn 满桌基准：仅两个底池</summary><p>现有 <code>full_table</code> 状态使用 <code>[120, 60]</code>。这张原始基准图未被修改；它没有覆盖九个底池的换行。</p><img src="data:image/png;base64,${originalBaseline}" alt="clrn 原有九人满桌双底池基准"></details>
<details class="sources"><summary>版本、验证与复现方法</summary><p>修改提交：<code>5d415f480</code>（2026-10-07）。修改前：<code>${provenance.previousCommit}</code>。</p><p>固定线上应用包：<code>${provenance.scriptPath}</code>；SHA-256：<code>${provenance.currentBundleSha256}</code>。</p><p>只在浏览器网络边界替换 <code>Pots.js</code> 及配套 <code>PotsStyle.js</code> 的模块。其余代码一致。仍执行正常初始化、真实登录、真实创建和进入私人房，牌局数据由 clrn 现有 WebSocket 代理回放；本次创建的房间均已解散。</p><p>截图前核对九人、九个底池节点和总额；原始坐标见 <code>measurements.json</code>，差异统计见 <code>differences.json</code>。</p><p>复现：在 clrn/visual 执行现有登录态采集，再设置 <code>COMPARISON_CLIENT_REPOSITORY</code> 与依赖目录运行 <code>comparisons/pots-2026-10-10/prepare-bundles.cjs</code>，然后用 <code>node --import tsx comparisons/pots-2026-10-10/capture.ts</code> 采集。设置 <code>VISUAL_SUITE=texas</code>、<code>VISUAL_LOCALES=zh-Hans</code> 和可用的 <code>MITMDUMP_PATH</code>。</p></details>
<footer>2026-10-10 · 本页包含全部对比图片，可单独离线打开或分享。</footer></main>
<script>
const scenes=${JSON.stringify(scenes)};let detailMode=false;let showDifference=false;
const device=document.getElementById('device'),state=document.getElementById('state');
function render(){const scene=scenes.find(item=>item.device===device.value&&item.state===state.value);for(const version of ['previous','current']){const image=document.getElementById(version+'Image');image.src=scene.images[version+(detailMode?'Detail':'')];image.className=!detailMode&&scene.device==='mobile'?'phone':'';const download=document.getElementById(version+'Download');download.href=scene.images[version];download.download=version+'-'+scene.filename;}document.getElementById('summary').textContent='底池排列：修改前 '+scene.previousRows+' 行 → 当前 '+scene.currentRows+' 行；容器高度 '+scene.previousHeight+' → '+scene.currentHeight+' 像素。';document.getElementById('differenceImage').src=scene.images[detailMode?'differenceDetail':'difference'];document.getElementById('differencePanel').style.display=showDifference?'block':'none';document.getElementById('whole').setAttribute('aria-pressed',String(!detailMode));document.getElementById('detail').setAttribute('aria-pressed',String(detailMode));document.getElementById('difference').setAttribute('aria-pressed',String(showDifference));}
device.onchange=state.onchange=render;document.getElementById('whole').onclick=()=>{detailMode=false;render()};document.getElementById('detail').onclick=()=>{detailMode=true;render()};document.getElementById('difference').onclick=()=>{showDifference=!showDifference;render()};render();
</script></html>`;
  writeFileSync(path.join(directory, 'comparison.html'), page);
  console.log(statistics);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
