import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Playwright 将 setup 设置的环境变量传给所有项目及重启后的 worker。 */
export default function setupAccountRun(): () => void {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-e2e-account-'));
  chmodSync(directory, 0o700);
  process.env.E2E_ACCOUNT_RUN_DIR = directory;
  // 返回全局 teardown，即使测试失败也清理凭据，不放进报告目录。
  return () => {
    rmSync(directory, { recursive: true, force: true });
    delete process.env.E2E_ACCOUNT_RUN_DIR;
  };
}
