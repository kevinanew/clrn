import { spawnSync } from 'node:child_process';
import { repository, sourceFiles } from './source-files.mjs';

// 使用固定版本的二进制包装包，macOS 和 CI 无需另行安装系统 ShellCheck。
const files = sourceFiles().filter(/** 仅保留满足以下条件的条目：`file.endsWith('.sh')`。
 * @param file - 当前源码或资源路径。 */ file => file.endsWith('.sh'));
if (files.length === 0) {
  console.log('ShellCheck：仓库没有 Shell 脚本。');
} else {
  const result = spawnSync('uvx', ['--from', 'shellcheck-py==0.11.0.1', 'shellcheck', ...files],
    { cwd: repository, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
