/** 汇总落盘副本；中断时保留原文件，明确报告缺失，不改变测试结果。 */
import { appendFile, readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 列出全部诊断文件，无需浏览器或额外依赖。
 * @param directory - 诊断目录。
 */
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(/** 缺少目录时仍生成说明。 */ () => []);
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else files.push(file);
  }
  return files.sort();
}

/**
 * 读取本仓库采集器的安全 JSON 副本。
 * @param file - JSON 文件。
 */
async function jsonFile(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return { unavailable: true }; }
}

/**
 * 阻止日志被解释成 Markdown 链接或 HTML。
 * @param value - 已脱敏内容。
 */
function plain(value) { return String(value ?? '').replace(/[\r\n|<>`]/g, ' ').replaceAll('[', ' ').replaceAll(']', ' ').slice(0, 600); }

/**
 * 合并同一用例的操作和浏览器事件，使用宿主时间。
 * @param directory - 用例目录。
 */
async function timeline(directory) {
  const files = (await filesIn(directory)).filter(/** 不重复导入上次生成的合并文件。
   * @param file - 日志文件。
   */ file => file.endsWith('.jsonl') && !file.endsWith('timeline.jsonl'));
  const events = [];
  for (const file of files) {
    for (const line of (await readFile(file, 'utf8')).trim().split('\n')) {
      try { events.push(JSON.parse(line)); }
      catch { events.push({ event: 'collection.incomplete-line', observedAt: 0 }); }
    }
  }
  events.sort(/** 稳定合并各来源的宿主时间。
   * @param left - 前一事件。
   * @param right - 后一事件。
   */ (left, right) => left.observedAt - right.observedAt);
  await writeFile(path.join(directory, 'timeline.jsonl'), events.map(/** 序列化安全事件。
   * @param event - 脱敏事件。
   */ event => JSON.stringify(event)).join('\n') + '\n');
  return events;
}

/**
 * 全局准备失败没有用例结果，也需要在 Summary 中显示安全错误。
 * @param file - 已脱敏运行日志。
 */
async function runnerErrors(file) {
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  const messages = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (/(?:error|failed)$/.test(event.event) || ['warn', 'error'].includes(event.level)
        || event.event === 'release.command-end' && event.code !== 0) {
        messages.push(`- ${plain(event.event)}: ${plain(event.text ?? event.reason)} ${plain(event.code)} ${plain(event.signal)}`);
      }
    } catch { messages.push('- 运行日志尾部未完成，请检查原文件。'); }
  }
  return messages.slice(-20);
}

/**
 * 只统计采集文件；生成的摘要和清单单独列出，重复汇总不会使用它们上次的大小。
 * @param directory - 诊断根目录。
 */
async function diagnosticInventory(directory) {
  const inventory = [];
  for (const file of await filesIn(directory)) {
    const relative = path.relative(directory, file);
    if (!['README.md', 'manifest.json'].includes(relative)) inventory.push({ file: relative, bytes: (await stat(file)).size });
  }
  return inventory;
}

/**
 * 按实际文件说明各来源的可用性；文件存在不能证明没有发生错误。
 * @param inventory - 采集文件清单。
 */
function sourceAvailability(inventory) {
  const sources = {};
  for (const [source, name] of Object.entries({ browser: 'browser.jsonl', steps: 'steps.jsonl',
    proxy: 'proxy.jsonl', release: 'release-server-events.jsonl' })) {
    const count = inventory.filter(/** 分别计算各个固定日志源取得的文件数。
     * @param file - 安全文件清单条目。
     */ file => path.basename(file.file) === name).length;
    sources[source] = { files: count, availability: count ? '已取得文件；内容可能仅含采集生命周期'
      : '未取得文件：可能未使用、未启动或采集不可用；不表示没有错误' };
  }
  return sources;
}

/**
 * 生成摘要、来源限制和完整清单，供所有 Web 工作流下载。
 * @param directory - 持续日志目录。
 * @param summaryFile - 可选的 GitHub Summary 入口；传 null 可禁用。
 */
export async function summarizeWebDiagnostics(directory = '.ci-diagnostics', summaryFile = process.env.GITHUB_STEP_SUMMARY) {
  await mkdir(directory, { recursive: true });
  const files = await filesIn(directory);
  const lines = ['# Web CI 诊断', '',
    '下载：GitHub → Actions → 本次运行 → Artifacts → web-diagnostics-*。保留 14 天。', '',
    'driver-completed 只说明驱动执行；应用处理须由对应断言或已有应用事件证实。',
    '未收到响应时 status=unavailable，不能据此推断 HTTP 500。',
    '应用未暴露的操作/切线原因、后端内部日志和构建已移除的输出均不可观测。',
    '无输出或采集不可用不表示没有错误。runner 被强制终止/失联时无法保证收尾和上传。', '',
    '浏览器、测试执行、代理输出每源最多 8 MiB，保留最早事件；每字段最多 2000 字符。',
    '*-manifest.json 记录保留时间范围、准确丢弃条数/字节及文本截断字符数。',
    '既有连接/代理历史为最近 5000 事件，独立记录 dropped。Release 日志的容量见其清单。', '',
    '来源：browser.jsonl（所有 console 级别、异常、崩溃、网络、应用已有事件）；',
    'steps.jsonl（操作、结果、测试执行输出）；proxy.jsonl（mitmdump 现有输出）；',
    'Release 静态服务日志；identity.json（run ID、attempt、测试/应用提交、Release、分片）。',
    '不采集 console 参数对象、请求/响应正文、认证缓存和网络 trace；自由文本中的对象/数组被隐藏。', '',
    'timeline.jsonl 按宿主时间合并同例日志；attachment-* 保留原截图、录像及脱敏连接诊断。',
    '每条命令、用例、设备、重复、重试和 worker 独立，后续成功不会覆盖前次失败。', '',
    '| 用例 / 设备 | 重复 / 重试 | 原始结果 | 失败步骤 / 关键错误 | 文件目录 |',
    '| --- | --- | --- | --- | --- |'];
  let cases = 0;
  for (const file of files.filter(/** 仅使用本仓库生成的用例清单。
   * @param file - 采集文件。
   */ file => path.basename(file) === 'case.json')) {
    const item = await jsonFile(file);
    const events = await timeline(path.dirname(file));
    const failures = events.filter(/** 保留驱动失败、浏览器异常和真实网络错误。
     * @param event - 时间线事件。
     */ event => event.outcome === 'failed' || event.errors?.length || ['warn', 'error'].includes(event.level)
       || typeof event.status === 'number' && event.status >= 400 || /(?:failed|error|crash|unavailable)$/.test(event.event));
    const errors = failures.slice(-4).map(/** 展示安全定位及真实错误类型、代码、状态。
     * @param event - 失败事件。
     */ event => plain([event.event, event.target, event.errorName, event.code, event.status, event.text,
       JSON.stringify(event.errors || [])].filter(Boolean).join(' ')));
    lines.push(`| ${plain(item.title)} / ${plain(item.project)} | ${item.repeat} / ${item.retry} | ${plain(item.status)} | ${errors.join('; ') || '未记录失败；结合原结果判断'} | ${path.relative(directory, path.dirname(file))} |`);
    cases++;
  }
  if (!cases) lines.push('', '未取得用例记录：可能尚未启动测试、发现/准备阶段失败或采集不可用；请检查 Actions 原步骤。');
  lines.push('', '## 运行与准备阶段', '');
  for (const file of files.filter(/** 包含全局发现/准备错误和登录态采集输出。
   * @param file - 已脱敏运行日志。
   */ file => ['runner.jsonl', 'release-server-events.jsonl'].includes(path.basename(file)))) {
    lines.push(...await runnerErrors(file));
  }
  const inventory = await diagnosticInventory(directory);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ files: inventory, cases,
    generatedFiles: ['README.md', 'manifest.json'],
    sources: { ...sourceAvailability(inventory), application: '仅构建已有事件', backend: '不可获取' } }, null, 2));
  lines.push('', '## 文件清单', '', ...inventory.map(/** 列出文件名和容量，不读取私有文件。
   * @param file - 文件名及大小。
   */ file => `- ${file.file} (${file.bytes} bytes)`), '- README.md / manifest.json（本次生成的摘要和清单）');
  const summary = lines.join('\n') + '\n';
  await writeFile(path.join(directory, 'README.md'), summary);
  if (summaryFile) await appendFile(summaryFile,
    summary.slice(0, 100000) + '\n完整摘要和清单见诊断附件 README.md / manifest.json。\n');
  return { cases, files: inventory.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await summarizeWebDiagnostics(process.env.CLRN_DIAGNOSTICS_DIR || '.ci-diagnostics');
}
