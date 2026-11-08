import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repository, sourceFiles } from './source-files.mjs';

/**
 * 复制门禁源码并只读链接依赖与 Git 元数据，隔离临时正负例。
 * @returns 临时仓库目录，由调用测试清理。
 */
export function isolatedVisualRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), 'clrn-visual-quality-'));
  for (const file of sourceFiles().filter(isGateSource)) {
    const target = path.join(directory, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(repository, file), target);
  }
  for (const entry of ['.git', 'node_modules']) symlinkSync(path.join(repository, entry), path.join(directory, entry));
  return directory;
}

/**
 * 仅复制正式门禁所需的源码、配置和 npm 入口，不复制快照或构建产物。
 * @param file - 仓库相对路径。
 * @returns 是否属于门禁夹具。
 */
function isGateSource(file) {
  return /^(?:scripts\/|visual\/.*\.[cm]?[jt]sx?$|eslint\.config\.mjs$|package\.json$)/.test(file);
}

/**
 * 通过正式 npm 入口检查实际退出状态。
 * @param directory - 隔离仓库目录。
 * @param modes - 可选的定向入口或报告参数。
 * @returns 门禁子进程结果。
 */
export function runVisualGate(directory, ...modes) {
  return spawnSync('npm', ['run', 'lint:visual-complexity', '--', ...modes],
    { cwd: directory, encoding: 'utf8', timeout: 30_000 });
}

/**
 * 将临时源码交给正式入口，断言退出码而非仅检查内存诊断。
 * @param directory - 隔离仓库目录。
 * @param file - 临时模块的绝对路径。
 * @param source - 静态正例、负例或解析错误。
 * @param expected - 预期退出状态。
 * @param mode - 定向入口参数。
 */
export function assertVisualGateStatus(directory, file, source, expected, mode) {
  const original = existsSync(file) ? readFileSync(file) : undefined;
  try {
    writeFileSync(file, source);
    const result = runVisualGate(directory, mode);
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stdout + result.stderr);
  } finally {
    restoreProbe(file, original);
  }
}

/**
 * 恢复原模块或删除新增负例，避免前一个案例污染后续边界验证。
 * @param file - 临时修改的模块路径。
 * @param original - 原模块内容；新增模块为 undefined。
 */
function restoreProbe(file, original) {
  if (original === undefined) rmSync(file);
  else writeFileSync(file, original);
}
