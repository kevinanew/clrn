#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { visualBaseUrl } from './target';
import fs from 'fs';
import path from 'path';
import { exactScenarioGrep, getVisualShardConfig, selectScenariosByLabel,
  VISUAL_SNAPSHOT_UPDATES, type VisualRunAction } from './run-visual-config';
import { getVisualSuite } from './visual-suite';
import {
  buildScenarios,
  getActiveLocales,
  VISUAL_DEVICE_ID,
  VISUAL_TEST_PASSWORD,
  VISUAL_TEST_USERNAME,
} from './scenarios';

const VISUAL_DIR = path.resolve(__dirname);
const VALID_ACTIONS = Object.keys(VISUAL_SNAPSHOT_UPDATES);

const requestedAction = process.argv[2] || 'test';
// 保留旧命令作为 reference 的别名，不维护另一套批准/更新规则。
const action = (requestedAction === 'approve' ? 'reference' : requestedAction) as VisualRunAction;

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

/**
 * 判断环境变量是否启用显式布尔开关。
 * @param name - 需要读取的环境变量名。
 */
function isEnvTrue(name: string): boolean {
  return process.env[name] === 'true';
}

/** 确认视觉任务在 Docker 或 CI 中执行，只有显式允许时才使用宿主机。 */
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

/** 确保基准更新使用 Linux 渲染环境，避免不同平台字体污染截图。 */
function ensureLinuxForBaselineUpdate(): void {
  if (action !== 'reference') {
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

/**
 * 在指定工作目录执行 pnpm，并在子进程失败时中止当前任务。
 * @param args - 传给子进程或浏览器初始化脚本的参数。
 * @param cwd - 子进程使用的工作目录。
 */
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

/** 返回按场景 label 选中的用例，用于计算安全分片与登录态需求。 */
function getSelectedScenarios(): ReturnType<typeof buildScenarios> {
  return selectScenariosByLabel(buildScenarios(), process.env.VISUAL_FILTER);
}

/** 各套件使用独立进程与登录态，过滤为空的套件不启动代理。 */
function runAllSuites(): void {
  let ranSuite = false;
  for (const suite of ['app', 'texas', 'zhajinhua'] as const) {
    const selected = selectScenariosByLabel(
      buildScenarios({ ...process.env, VISUAL_SUITE: suite }), process.env.VISUAL_FILTER,
    );
    if (selected.length === 0) continue;
    ranSuite = true;
    const result = spawnSync('pnpm', ['exec', 'tsx', 'run-visual.ts', action], {
      stdio: 'inherit', cwd: VISUAL_DIR,
      env: { ...process.env, VISUAL_SUITE: suite, VISUAL_SKIP_VISUAL_INSTALL: 'true',
        VISUAL_SKIP_SUPPORT_TESTS: suite !== 'app' ? 'true' : process.env.VISUAL_SKIP_SUPPORT_TESTS },
    });
    if (result.status !== 0) throw new Error(`${suite} 视觉测试失败（退出码 ${result.status ?? 1}）`);
  }
  if (!ranSuite) throw new Error('VISUAL_FILTER 没有匹配任何场景');
}

/**
 * 运行一种语言的所选场景，每批重新采集短期认证。
 * @param locale - 当前场景语言。
 * @param playwrightArgs - 所有套件共用的比较或采集参数。
 */
function runScenarioBatches(locale: string, playwrightArgs: string[]): boolean {
  const batchLabel = action.toUpperCase();
  const selectedScenarios = getSelectedScenarios();
  if (selectedScenarios.length === 0) {
    console.log(`${batchLabel} SKIP > VISUAL_LOCALES=${locale} 没有匹配场景`);
    return false;
  }

  const scenarioArgs = process.env.VISUAL_FILTER
    ? [...playwrightArgs, `--grep=${exactScenarioGrep(selectedScenarios.map(/** 将当前条目映射为`scenario.label`。
 * @param scenario - 当前测试场景配置。 */ scenario => scenario.label))}`]
    : playwrightArgs;
  const needsAuthState = selectedScenarios.some(/** 判断是否存在满足以下条件的条目：`scenario.signIn`。
 * @param scenario - 当前测试场景配置。 */ (scenario) => scenario.signIn);
  const { count: shardCount, start: startShard } = getVisualShardConfig(
    action,
    selectedScenarios.length,
  );

  for (let shard = startShard; shard <= shardCount; shard += 1) {
    console.log(`${batchLabel} BATCH > VISUAL_LOCALES=${locale}, SHARD=${shard}/${shardCount}`);
    if (needsAuthState) {
      // 上一个 Playwright 进程已同步退出，此时换 token 不会作废仍在运行的场景。
      // 紧邻 shard 启动采集，确保每批都获得完整有效期。
      captureAuthState();
    }
    runPnpm([...scenarioArgs, 'cases', `--shard=${shard}/${shardCount}`]);
  }
  return true;
}

/** 按套件和分片启动视觉任务，为每批场景采集登录态并传递失败结果。 */
async function main(): Promise<void> {
  console.log(`VISUAL_LOCALES=${process.env.VISUAL_LOCALES}`);

  if (!isEnvTrue('VISUAL_SKIP_VISUAL_INSTALL')) {
    console.log('正在安装视觉回归测试依赖...');
    runPnpm(['install', '--frozen-lockfile']);
  }

  if (getVisualSuite() === 'all') return runAllSuites();

  try {
    console.log(`线上视觉测试地址: ${visualBaseUrl}`);
    // 所有套件使用同一规则：普通比较只读；显式采集保存所选场景的当前画面。
    const playwrightArgs = ['exec', 'playwright', 'test', `--update-snapshots=${VISUAL_SNAPSHOT_UPDATES[action]}`];

    // 比较、采集及 filter/core scope 都可能包含超过 token 生命周期的登录场景。
    // 统一逐语言切成短 shard；每批启动新的 worker/browser，且最多包含三个场景。
    const batchLabel = action.toUpperCase();
    if (!isEnvTrue('VISUAL_SKIP_SUPPORT_TESTS')) {
      console.log(`${batchLabel} SUPPORT > tests/`);
      // support 用例不属于场景 label，不能继承用户的 --grep，否则会误报“没有测试”。
      runPnpm(['exec', 'playwright', 'test', 'tests']);
    }

    const requestedLocales = process.env.VISUAL_LOCALES;
    const selectedLocales = getActiveLocales().map(/** 将当前条目映射为`locale.code`。
 * @param locale - 当前测试使用的语言。 */ (locale) => locale.code);
    let ranVisualScenario = false;

    for (const locale of selectedLocales) {
      process.env.VISUAL_LOCALES = locale;
      if (runScenarioBatches(locale, playwrightArgs)) ranVisualScenario = true;
    }

    if (requestedLocales === undefined) {
      delete process.env.VISUAL_LOCALES;
    } else {
      process.env.VISUAL_LOCALES = requestedLocales;
    }

    if (!ranVisualScenario) {
      // 与 Playwright 一样将无匹配 filter 视为错误，而不是静默成功。
      runPnpm([...playwrightArgs, `--grep=${exactScenarioGrep([])}`, 'cases']);
    }
  } finally {
    fs.rmSync(path.join(VISUAL_DIR, 'auth-state.json'), { force: true });
  }
}

main().catch(/** 输出视觉运行器错误并以失败状态退出。
 * @param error - 当前操作抛出的错误。 */ (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
