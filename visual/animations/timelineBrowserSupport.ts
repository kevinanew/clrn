import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { spawnSync } from 'node:child_process';

/**
 * 保留子进程退出码与原始诊断。
 * @param result - 真实 Playwright 进程结果。
 * @param expected - 原预期退出码。
 */
export function assertProcessStatus(result: ReturnType<typeof spawnSync>, expected: number) {
  assert.equal(result.status, expected, result.error?.message || String(result.stdout) + String(result.stderr));
}

/**
 * 读取临时目录内全部基准，供比较后逐字节核对。
 * @param directory - 临时基准目录。
 */
export async function snapshotContents(directory: string) {
  const names = await readdir(directory);
  return new Map(await Promise.all(names.map(/** 保存文件名与原始 PNG 字节。
   * @param name - 当前基准文件名。 */ async name =>
    [name, await readFile(path.join(directory, name))] as const)));
}

/**
 * 普通比较不得新增、删除或改写临时基准。
 * @param directory - 临时基准目录。
 * @param before - 比较前的全部文件。
 */
export async function assertSnapshotsUnchanged(directory: string, before: Map<string, Buffer>) {
  assert.deepEqual((await readdir(directory)).sort(), [...before.keys()].sort(), '比较不得创建缺失基准');
  for (const [name, contents] of before) {
    assert.deepEqual(await readFile(path.join(directory, name)), contents, '比较不得修改旧基准');
  }
}

/**
 * 读取报告附件的文件或内联内容。
 * @param attachment - 原始报告附件。
 */
export async function attachmentContents(attachment: { path?: string; body?: string }) {
  return attachment.path ? readFile(attachment.path, 'utf8') : Buffer.from(attachment.body!, 'base64').toString();
}
