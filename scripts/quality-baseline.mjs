import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { repository } from './source-files.mjs';

/**
 * 用规则、文件、诊断及源码行指纹定位历史违规，行号仅用于审阅。
 * @param finding - 工具的单位置诊断。
 * @returns 不含源码正文的历史清单条目。
 */
export function fingerprint(finding) {
  if (finding.file.startsWith('/') || finding.file.split('/').includes('..')) throw new Error('诊断路径必须位于仓库内。');
  const line = readFileSync(`${repository}/${finding.file}`, 'utf8').split('\n')[finding.line - 1];
  return { ...finding, anchor: createHash('sha256').update(line.trim()).digest('hex') };
}

/**
 * 生成与行号无关的精确身份；诊断包含实测复杂度，因此历史函数也不能继续变复杂。
 * @param finding - 带源码指纹的诊断。
 * @returns 用于比较的稳定键。
 */
export function findingKey(finding) {
  return JSON.stringify([finding.file, finding.rule, finding.anchor, finding.message]);
}

/**
 * 统计同一文件同一源码锚点的次数，避免旧豁免被重复使用。
 * @param findings - 待统计的位置清单。
 * @returns 每个精确身份的次数。
 */
function counts(findings) {
  const result = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

/**
 * 消耗精确的旧违规名额；其余问题一律失败。
 * @param findings - 当前工具报告。
 * @param baseline - 已审查的历史清单。
 * @returns 未登记的新问题。
 */
export function newFindings(findings, baseline) {
  const remaining = counts(baseline);
  return findings.filter(finding => {
    const key = findingKey(finding), count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

/**
 * 验证清单只减不增；诊断指纹和次数不可替换或放宽。
 * @param current - 工作树清单。
 * @param previous - 比较基准清单。
 */
export function assertShrinking(current, previous) {
  if (newFindings(current.findings, previous.findings).length) throw new Error('历史违规清单只能缩减，不能新增或替换。');
  for (const [key, count] of Object.entries(current.fingerprints ?? {})) {
    if (!Number.isInteger(count) || count < 1 || count > (previous.fingerprints?.[key] ?? 0)) {
      throw new Error(`重复代码基线只能缩减：${key}`);
    }
  }
}

/**
 * 从明确的 Git 基准读取旧清单，首次引入时允许审阅初始化清单。
 * @param ref - CI 的 PR base、push before，或本机 HEAD。
 * @param file - 清单路径。
 * @returns 已存在的清单；仅路径尚未引入时返回空值。
 */
function previousManifest(ref, file) {
  // 先验证 ref，避免浅克隆、拼错 ref 或 Git 失败被误当作首次初始化。
  execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repository, stdio: 'pipe' });
  const tree = execFileSync('git', ['ls-tree', ref, '--', file], { cwd: repository, encoding: 'utf8' });
  if (!tree.trim()) return undefined;
  return JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { cwd: repository, encoding: 'utf8' }));
}

/**
 * 检查实际历史清单及原生 jscpd 基线，相对 Git 基准禁止扩张。
 */
export function checkBaseline() {
  const ref = process.env.QUALITY_BASE_REF || 'HEAD';
  for (const file of ['quality/baseline.json', 'quality/jscpd-baseline.json']) {
    const current = JSON.parse(readFileSync(`${repository}/${file}`, 'utf8'));
    const previous = previousManifest(ref, file);
    if (previous) assertShrinking({ findings: [], ...current }, { findings: [], ...previous });
  }
  const { findings } = JSON.parse(readFileSync(`${repository}/quality/baseline.json`, 'utf8'));
  const allowed = new Set(['complexity', 'max-depth', 'quality/no-network-response', 'C901']);
  if (findings.some(item => !item.reason?.trim() || !item.anchor || !item.file || !item.line || !allowed.has(item.rule))) {
    throw new Error('历史清单必须包含精确位置、源码指纹和迁移/单测例外理由。');
  }
}
