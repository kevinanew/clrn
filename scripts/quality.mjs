import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkBaseline, newFindings } from './quality-baseline.mjs';
import { javascriptFindings, pythonFindings, runJSON } from './quality-lint.mjs';
import { repository, sourceFiles } from './source-files.mjs';
import { writeDuplicationSources } from './documentation-projection.mjs';

/**
 * 执行 dependency-cruiser 原生循环和边界规则，不使用历史排除。
 * @returns 完整依赖图与违规报告。
 */
export function architectureReport() {
  const files = sourceFiles().filter(/** 选择 JS/TS 源码作为依赖图入口，覆盖所有手写模块。
 * @param file - 当前源码或资源路径。 */ file => /\.[cm]?[jt]sx?$/.test(file));
  const { report, status } = runJSON(process.execPath, ['node_modules/dependency-cruiser/bin/dependency-cruiser.mjs',
    '--config', '.dependency-cruiser.cjs', '--output-type', 'json', ...files]);
  if (!report.modules?.length || (status && !report.summary?.violations?.length)) throw new Error('依赖图检查未正常完成。');
  return report;
}

/**
 * 使用 jscpd 原生内容指纹和次数基线；报告仅写临时目录并立即清理。
 * @returns 不含源码片段的逐位置重复报告。
 */
export function duplicationReport() {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-quality-'));
  try {
    const sources = join(directory, 'sources');
    mkdirSync(sources);
    const sourceCount = writeDuplicationSources(sources);
    const baseline = join(directory, 'baseline.json');
    copyFileSync(join(repository, 'quality/jscpd-baseline.json'), baseline);
    const result = spawnSync(process.execPath, [join(repository, 'node_modules/jscpd/run-jscpd.js'), '.', '--config', join(repository, '.jscpd.json'),
      '--baseline', baseline, '--update-baseline', '--output', directory, '--fail-on-empty', '--silent'],
    { cwd: sources, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (![0, 1].includes(result.status)) throw new Error(`jscpd 异常退出：${result.stderr}`);
    const report = JSON.parse(readFileSync(join(directory, 'jscpd-report.json'), 'utf8'));
    if (result.status && !report.duplicates.some(/** 确认 jscpd 失败确实来自新增重复，而非工具异常。
 * @param item - 当前遍历的条目。 */ item => item.isNew)) throw new Error(`jscpd 检查失败：${result.stderr}`);
    const { fingerprints } = JSON.parse(readFileSync(baseline, 'utf8'));
    return { sourceCount, statistics: report.statistics, fingerprints, duplicates: report.duplicates.map(/** 移除重复报告中的源码片段，保留安全的位置与指纹信息。
 * @param item - 当前遍历的条目。 */ item => {
      const safe = { ...item };
      delete safe.fragment;
      return safe;
    }) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * 打印新增错误并将进程标记为失败，历史清单不隐藏本次测量的数量。
 * @param findings - 本次实测诊断。
 */
function checkFindings(findings) {
  const { findings: baseline } = JSON.parse(readFileSync(join(repository, 'quality/baseline.json'), 'utf8'));
  const added = newFindings(findings, baseline);
  const relevant = baseline.filter(/** 按当前扫描语言选择历史条目，检查是否存在已经消除的违规。
 * @param item - 当前遍历的条目。 */ item => mode === 'python' ? item.rule === 'C901' : item.rule !== 'C901');
  const stale = newFindings(relevant, findings);
  console.log(`静态诊断：${findings.length} 个历史/当前问题，${added.length} 个未登记问题。`);
  for (const item of added) console.error(`${item.file}:${item.line}:${item.column} ${item.rule} ${item.message}`);
  for (const item of stale) console.error(`请删除已消除的历史条目：${item.file}:${item.line} ${item.rule}`);
  if (added.length || stale.length) process.exitCode = 1;
}

const mode = process.argv[2];
if (mode === 'report') {
  const javascript = await javascriptFindings();
  const python = pythonFindings();
  const architecture = architectureReport();
  console.log(JSON.stringify({ javascript, python, architecture, duplication: duplicationReport() }, null, 2));
} else {
  checkBaseline();
  if (mode === 'javascript') checkFindings(await javascriptFindings());
  else if (mode === 'python') checkFindings(pythonFindings());
  else if (mode === 'architecture') {
    const report = architectureReport();
    console.log(`dependency-cruiser：${report.modules.length} 个模块，${report.summary.violations.length} 个违规。`);
    for (const violation of report.summary.violations) console.error(JSON.stringify(violation));
    if (report.summary.violations.length) process.exitCode = 1;
  } else if (mode === 'duplication') {
    const { duplicates, fingerprints } = duplicationReport();
    const added = duplicates.filter(/** 提取新增重复组，输出需要处理的源码位置。
 * @param item - 当前遍历的条目。 */ item => item.isNew);
    const baseline = JSON.parse(readFileSync(join(repository, 'quality/jscpd-baseline.json'), 'utf8'));
    const stale = Object.keys(baseline.fingerprints).filter(/** 查找已消失或次数减少的重复指纹，要求同步缩减历史基线。
 * @param key - 当前操作使用的 key。 */ key => (fingerprints[key] ?? 0) < baseline.fingerprints[key]);
    console.log(`jscpd：${duplicates.length} 组重复，${added.length} 组新增。`);
    for (const item of added) console.error(`${item.firstFile.name}:${item.firstFile.start} ↔ ${item.secondFile.name}:${item.secondFile.start}`);
    if (stale.length) console.error('请缩减已消除的 jscpd 指纹/次数：', stale.join(', '));
    if (added.length || stale.length) process.exitCode = 1;
  } else throw new Error(`未知静态检查模式：${mode}`);
}
