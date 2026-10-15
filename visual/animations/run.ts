import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getVisualSuite } from '../visual-suite';

const directory = path.resolve(__dirname, '..');
const selected = getVisualSuite();
const suites = selected === 'all' ? ['app', 'texas', 'zhajinhua'] : [selected];
const files = { app: ['search-prompt.spec.ts', 'application.spec.ts', 'ambient.spec.ts', 'dialogs.spec.ts', 'skeleton.spec.ts', 'slot.spec.ts', 'slotPopups.spec.ts'],
  texas: ['texas.spec.ts'], zhajinhua: ['zhajinhua.spec.ts'] };

/**
 * 串行执行登录采集和动画套件；失败立即终止，防止后续登录覆盖待诊断会话。
 * @param args - tsx 或 Playwright 的参数数组。
 * @param environment - 本轮独占账号与套件环境。
 */
function run(args: string[], environment: NodeJS.ProcessEnv): void {
  const result = spawnSync('pnpm', ['exec', ...args], { cwd: directory, env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`动画子进程失败：${result.status ?? result.signal}`);
}

const temporary = mkdtempSync(path.join(tmpdir(), 'clrn-animations-'));
try {
  for (const suite of suites) {
    const environment = { ...process.env, VISUAL_SUITE: suite,
      VISUAL_AUTH_STATE_PATH: path.join(temporary, `${suite}-auth.json`),
      VISUAL_AUTH_USES_MITMPROXY: suite === 'app' ? 'false' : 'true',
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(directory, 'playwright-report', 'animations', suite) };
    run(['tsx', 'src/captureAuthState.ts'], environment);
    run(['playwright', 'test', '--config', 'animations/playwright.config.ts',
      ...files[suite as keyof typeof files], `--output=test-results/animations/${suite}`,
      ...process.argv.slice(2)], environment);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
