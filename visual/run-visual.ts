#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { visualBaseUrl } from './target';
import fs from 'fs';
import path from 'path';
import { getVisualShardConfig } from './run-visual-config';
import {
  buildScenarios,
  getActiveLocales,
  VISUAL_DEVICE_ID,
  VISUAL_TEST_PASSWORD,
  VISUAL_TEST_USERNAME,
} from './scenarios';

const VISUAL_DIR = path.resolve(__dirname);
const VALID_ACTIONS = ['test', 'reference', 'approve'] as const;
type Action = (typeof VALID_ACTIONS)[number];

const action = (process.argv[2] || 'test') as Action;

if (!VALID_ACTIONS.includes(action)) {
  console.error(`未知操作: ${action}`);
  console.error(`用法: tsx run-visual.ts [${VALID_ACTIONS.join('|')}]`);
  process.exit(1);
}

process.env.VISUAL_BASE_URL = visualBaseUrl;
if (!process.env.VISUAL_LOCALES) {
  process.env.VISUAL_LOCALES = 'zh-Hans';
}

process.chdir(VISUAL_DIR);

function isEnvTrue(name: string): boolean {
  return process.env[name] === 'true';
}

function ensureDockerOrCi(): void {
  if (isEnvTrue('VISUAL_ALLOW_HOST')) {
    return;
  }

  const inDocker = fs.existsSync('/.dockerenv');
  const inCi = Boolean(process.env.CI) || Boolean(process.env.WOODPECKER_CI);

  if (!inDocker && !inCi) {
    console.error('视觉回归必须在 Docker 容器中运行，禁止在宿主机直接执行 Playwright。');
    console.error('');
    console.error('请使用以下命令之一：');
    console.error('  cd visual && pnpm run test');
    process.exit(1);
  }
}

function ensureLinuxForBaselineUpdate(): void {
  if (action !== 'reference' && action !== 'approve') {
    return;
  }

  if (process.platform !== 'linux') {
    console.error('基准截图必须在 Linux 环境（Docker / CI）中生成，与 CI 渲染结果保持一致。');
    console.error('');
    console.error('请使用以下命令之一：');
    console.error('  cd visual && pnpm run reference');
    process.exit(1);
  }
}

ensureDockerOrCi();
ensureLinuxForBaselineUpdate();

function runPnpm(args: string[], cwd = VISUAL_DIR): void {
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    env: process.env,
    cwd,
  });

  if (result.status !== 0) {
    throw new Error(`测试命令失败：pnpm ${args.join(' ')}（退出码 ${result.status ?? 1}）`);
  }
}

/**
 * 登录并保存登录态（auth-state.json），之后当前 shard 的登录场景由 pageSetup
 * 直接注入，免去逐场景 UI 登录。每个含登录场景的短 shard 开始前都会重新采集，
 * 减少 staging 登录凭据在长轮次中失效对后续场景的影响。
 * 采集器内部会重试 staging 瞬时失败；仍失败则中止本轮。
 * 并行场景不能各自回退 UI 登录，否则同一账号重复登录会互相作废 token。
 */
function captureAuthState(): void {
  const authStatePath = path.join(VISUAL_DIR, 'auth-state.json');
  const maxProcessAttempts = 2;

  for (let processAttempt = 1; processAttempt <= maxProcessAttempts; processAttempt += 1) {
    fs.rmSync(authStatePath, { force: true });
    console.log(
      `正在采集登录态（供后续登录场景注入；进程 ${processAttempt}/${maxProcessAttempts}）...`,
    );
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/captureAuthState.ts'], {
      stdio: 'inherit',
      cwd: VISUAL_DIR,
      env: {
        ...process.env,
        VISUAL_BASE_URL: visualBaseUrl,
        VISUAL_USERNAME: process.env.VISUAL_USERNAME || VISUAL_TEST_USERNAME,
        VISUAL_PASSWORD: process.env.VISUAL_PASSWORD || VISUAL_TEST_PASSWORD,
        VISUAL_DEVICE_ID,
      },
      timeout: 600000,
    });

    if (result.status === 0 && fs.existsSync(authStatePath)) {
      return;
    }

    console.error(
      `AUTH STATE PROCESS > 第 ${processAttempt} 次退出异常：status=${String(
        result.status,
      )}, signal=${String(result.signal)}, error=${result.error?.message || 'none'}`,
    );
  }

  throw new Error('登录态采集进程连续失败，已中止本轮视觉回归');
}

/** 返回 Playwright --grep 实际会选中的场景，用于计算安全分片与登录态需求。 */
function getSelectedScenarios(): ReturnType<typeof buildScenarios> {
  const scenarios = buildScenarios();
  const filter = process.env.VISUAL_FILTER;
  let matcher: RegExp | undefined;
  if (filter) {
    try {
      matcher = new RegExp(filter);
    } catch {
      // Playwright 会给出正式的无效 grep 错误；这里只保守地按全部场景规划。
      return scenarios;
    }
  }
  return matcher ? scenarios.filter((scenario) => matcher.test(scenario.label)) : scenarios;
}

async function main(): Promise<void> {
  console.log(`VISUAL_LOCALES=${process.env.VISUAL_LOCALES}`);

  if (!isEnvTrue('VISUAL_SKIP_VISUAL_INSTALL')) {
    console.log('正在安装视觉回归测试依赖...');
    runPnpm(['install', '--frozen-lockfile']);
  }

  try {
    console.log(`线上视觉测试地址: ${visualBaseUrl}`);
    const playwrightArgs = ['exec', 'playwright', 'test'];
    if (action === 'reference') {
      // 只重写有显著视觉差异的基准。截图断言不再使用按面积放宽的比例容差：
      // 任意超过 threshold 的像素都会触发更新；仅忽略 Docker Chromium 产生的
      // 1–4 级 RGB 抗锯齿舍入噪声，避免 `all` 每轮把肉眼不可见差异写回文件。
      playwrightArgs.push('--update-snapshots=changed');
    } else if (action === 'approve') {
      // approve：只接受上次 test 里真正 diff/失败的场景为新基准，未变化的不动
      playwrightArgs.push('--update-snapshots');
    }
    if (process.env.VISUAL_FILTER) {
      playwrightArgs.push(`--grep=${process.env.VISUAL_FILTER}`);
    }

    // test/reference/approve 以及 filter/core scope 都可能包含超过 token 生命周期的登录场景。
    // 统一逐语言切成短 shard；每批启动新的 worker/browser，且最多包含三个场景。
    const batchLabel = action.toUpperCase();
    console.log(`${batchLabel} SUPPORT > tests/preparePage.spec.ts`);
    // support 用例不属于场景 label，不能继承用户的 --grep，否则会误报“没有测试”。
    runPnpm(['exec', 'playwright', 'test', 'tests/preparePage.spec.ts']);

    const requestedLocales = process.env.VISUAL_LOCALES;
    const selectedLocales = getActiveLocales().map((locale) => locale.code);
    let ranVisualScenario = false;

    for (const locale of selectedLocales) {
      process.env.VISUAL_LOCALES = locale;
      const selectedScenarios = getSelectedScenarios();
      if (selectedScenarios.length === 0) {
        console.log(`${batchLabel} SKIP > VISUAL_LOCALES=${locale} 没有匹配场景`);
        continue;
      }

      ranVisualScenario = true;
      const needsAuthState = selectedScenarios.some((scenario) => scenario.signIn);
      const { count: shardCount, start: startShard } = getVisualShardConfig(
        action,
        selectedScenarios.length,
      );

      for (let shard = startShard; shard <= shardCount; shard += 1) {
        console.log(`${batchLabel} BATCH > VISUAL_LOCALES=${locale}, SHARD=${shard}/${shardCount}`);
        if (needsAuthState) {
          // 上一个 Playwright 进程已同步退出，此时换 token 不会作废仍在运行的场景。
          // 紧邻 shard 启动采集，确保 filter/core scope/approve 的每批都获得完整有效期。
          captureAuthState();
        }
        runPnpm([...playwrightArgs, 'tests/visual.spec.ts', `--shard=${shard}/${shardCount}`]);
      }
    }

    if (requestedLocales === undefined) {
      delete process.env.VISUAL_LOCALES;
    } else {
      process.env.VISUAL_LOCALES = requestedLocales;
    }

    if (!ranVisualScenario) {
      // 保留 Playwright 对无匹配 filter 的标准错误，而不是静默成功。
      runPnpm([...playwrightArgs, 'tests/visual.spec.ts']);
    }
  } finally {
    fs.rmSync(path.join(VISUAL_DIR, 'auth-state.json'), { force: true });
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
