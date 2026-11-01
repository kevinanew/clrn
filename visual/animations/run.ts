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
const parts: Record<Exclude<typeof selected, 'all'>, Record<string, { files: string[]; grep?: string }>> = {
  app: {
    application: { files: ['application.spec.ts'] },
    ui: { files: ['search-prompt.spec.ts', 'ambient.spec.ts', 'dialogs.spec.ts',
      'skeleton.spec.ts', 'slot.spec.ts', 'slotPopups.spec.ts'] },
  },
  texas: {
    table: { files: ['texas.spec.ts'], grep: 'texas (panels animations|hall panel animations)' },
    gameplay: { files: ['texas.spec.ts'], grep: 'texas gameplay animations' },
    'card-sprite-control': { files: ['cardSpriteControl.spec.ts'] },
    social: { files: ['texas.spec.ts'], grep: 'texas (social|assets) animations' },
  },
  zhajinhua: Object.fromEntries(['panels', 'gameplay'].map(part => [part,
    { files: ['zhajinhua.spec.ts'], grep: `zhajinhua ${part} animations` }])),
};
const selectedPart = process.env.ANIMATION_PART || 'all';
if (selectedPart !== 'all' && (selected === 'all' || !parts[selected][selectedPart])) {
  throw new Error(`ANIMATION_PART 无效: suite=${selected}, part=${selectedPart}`);
}

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
    const selection: { files: string[]; grep?: string } = selectedPart === 'all' ? { files: files[suite as keyof typeof files] }
      : parts[suite as keyof typeof parts][selectedPart];
    const environment = { ...process.env, VISUAL_SUITE: suite, VISUAL_LOCALES: 'en',
      VISUAL_AUTH_STATE_PATH: path.join(temporary, `${suite}-auth.json`),
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(directory, 'playwright-report',
        selectedPart === 'card-sprite-control' ? 'card-sprite-control' : 'animations', suite) };
    run(['tsx', 'src/captureAuthState.ts'], environment);
    run(['playwright', 'test', '--config', selectedPart === 'card-sprite-control'
      ? 'animations/cardSpriteControl.config.ts' : 'animations/playwright.config.ts',
      ...selection.files, ...(selection.grep ? [`--grep=${selection.grep}`] : []),
      `--output=test-results/${selectedPart === 'card-sprite-control' ? 'card-sprite-control' : 'animations'}/${suite}`,
      ...process.argv.slice(2)], environment);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
