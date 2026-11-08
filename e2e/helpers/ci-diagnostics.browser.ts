/** 真正运行公共 fixture/reporter：成功、失败、超时、重试及后续命令均只访问本机。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * 收集临时附件的全部文件。
 * @param directory - 诊断目录。
 */
async function filesIn(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else files.push(file);
  }
  return files;
}

/**
 * 原样返回执行退出码；故意失败的子测试不能被报告器改成成功。
 * @param args - Node 子进程参数。
 * @param environment - 隔离的测试环境。
 */
async function runNode(args: string[], environment: NodeJS.ProcessEnv): Promise<number> {
  return new Promise(/** 执行真正的 Playwright CLI，不打印包含公开哨兵的原始输出。
   * @param resolve - 返回真实退出码。
   */ resolve => execFile(process.execPath, args, { env: environment, timeout: 90000 },
    /** 保持原始测试状态，诊断不能吞掉错误。
     * @param error - CLI 失败或超时。
     */ error => resolve(error ? Number(error.code) || 1 : 0)));
}

for (const project of ['e2e', 'visual']) test(`${project} 公共 fixture 保存失败前输出、页面、实际状态和截图，超时/重试/后续命令不覆盖`, { timeout: 120000 },
  /** 在本机服务器和真实 Chromium 中验证完整产物链路。
   * @param context - 测试清理接口。
   */ async context => {
    const directory = await mkdtemp(path.join(tmpdir(), 'clrn-ci-diagnostics-'));
    context.after(/** 删除所有公开哨兵和生成产物。 */ () => rm(directory, { force: true, recursive: true }));
    const root = path.resolve(__dirname, '../..');
    const server = spawn('python3', [path.join(root, 'e2e/mitmproxy/diagnostic_test_server.py')]);
    context.after(/** 停止独立的 Python 测试源。 */ () => { server.kill(); });
    const port = await new Promise<number>(/** 等待 Python 回环服务器报告就绪端口。
     * @param resolve - 就绪端口。
     * @param reject - Python 启动失败。
     */ (resolve, reject) => {
      server.once('error', reject);
      server.stdout.once('data', /** 端口只用于本机自测，不写入诊断附件。
       * @param data - 本机端口数字。
       */ data => resolve(Number(String(data).trim())));
    });
    const reporter = path.join(root, 'e2e/helpers/diagnostic-reporter.ts');
    const wrapper = path.join(root, project === 'e2e' ? 'e2e/helpers/diagnostic-test.ts' : 'visual/src/support/diagnosticTest.ts');
    const configuration = path.join(directory, 'playwright.config.cjs');
    await writeFile(configuration, `module.exports = {testDir:__dirname, testMatch:'controlled.spec.ts', workers:1, retries:0,
      outputDir:${JSON.stringify(path.join(directory, 'results'))}, timeout:10000,
      reporter:[[${JSON.stringify(reporter)}]], projects:[{name:'offline-mobile',use:{viewport:{width:375,height:812}}},
      {name:'offline-api',use:{launchOptions:{executablePath:'/public-nonexistent-browser-sentinel'}}}],
      use:{screenshot:'only-on-failure', trace:'off'}};`);
    await writeFile(path.join(directory, 'controlled.spec.ts'), `import {test} from ${JSON.stringify(wrapper)};
      test('controlled-failure', async ({page,context})=>{
        await test.step('before-failure-click action',async()=>{await page.goto(process.env.LOCAL_DIAGNOSTIC_URL!);await page.getByTestId('password').fill('public-input-sentinel');await page.getByTestId('action').click()});
        const popup=await context.newPage();await popup.goto(process.env.LOCAL_DIAGNOSTIC_URL!);
        await popup.waitForTimeout(150);
        process.stdout.write('Authorization: Bea');process.stdout.write('rer public-stdout-sentinel\\n');
        throw new Error('controlled-failure-marker');
      });
      test('controlled-timeout',async({page})=>{test.setTimeout(2000);await page.goto(process.env.LOCAL_DIAGNOSTIC_URL!);await page.getByTestId('missing-target').click()});
      test.describe('retry',()=>{test.describe.configure({retries:1});test('retry-recovers',async({page},info)=>{
        await page.goto(process.env.LOCAL_DIAGNOSTIC_URL!);if(!info.retry)throw new Error('initial-failure-marker');
      })});
      test('later-success',async({page})=>{await page.goto(process.env.LOCAL_DIAGNOSTIC_URL!)});
      test('api-only',async({request})=>{const response=await request.get(process.env.LOCAL_DIAGNOSTIC_URL!);if(response.status()!==200)throw new Error('api failure')});`);
    const cli = createRequire(path.join(root, project, 'package.json')).resolve('@playwright/test/cli');
    const environment = { ...process.env, CLRN_DIAGNOSTICS_DIR: path.join(directory, 'diagnostics'),
      GITHUB_STEP_SUMMARY: path.join(directory, 'github-summary.md'),
      LOCAL_DIAGNOSTIC_URL: `http://127.0.0.1:${port}`, GITHUB_RUN_ID: '121', GITHUB_RUN_ATTEMPT: '2',
      CLRN_EXPECTED_APPLICATION_COMMIT: 'a'.repeat(40), CLRN_RELEASE_TAG: 'public-fixture-release' };
    assert.equal(await runNode([cli, 'test', '--config', configuration, '--project', 'offline-mobile', '--grep-invert', 'later-success|api-only'], environment), 1);
    const before = await filesIn(environment.CLRN_DIAGNOSTICS_DIR);
    assert.equal(await runNode([cli, 'test', '--config', configuration, '--project', 'offline-mobile', '--grep', 'later-success'], environment), 0);
    assert.equal(await runNode([cli, 'test', '--config', configuration, '--project', 'offline-api', '--grep', 'api-only'], environment), 0,
      '纯 API 测试不能因诊断 fixture 而启动不存在的浏览器');
    const after = await filesIn(environment.CLRN_DIAGNOSTICS_DIR);
    for (const file of before) assert.ok(after.includes(file), '后续命令不能覆盖早期记录');
    const cases = [];
    for (const file of after.filter(/** 读取实际报告器写出的用例状态。
     * @param file - 诊断文件。
     */ file => file.endsWith('/case.json'))) cases.push({ directory: path.dirname(file), ...JSON.parse(await readFile(file, 'utf8')) });
    assert.equal(cases.length, 6);
    assert.ok(cases.some(/** 保留真正超时状态。
     * @param item - 用例记录。
     */ item => item.status === 'timedOut'));
    assert.ok(cases.some(/** 初次失败与成功重试各自存在。
     * @param item - 用例记录。
     */ item => item.title.includes('retry-recovers') && item.retry === 0 && item.status === 'failed'));
    assert.ok(cases.some(/** 重试成功不能覆盖失败。
     * @param item - 用例记录。
     */ item => item.title.includes('retry-recovers') && item.retry === 1 && item.status === 'passed'));
    const failed = cases.find(/** 定位受控失败的截图与日志所属目录。
     * @param item - 用例记录。
     */ item => item.title.includes('controlled-failure'));
    assert.ok(after.some(/** 截图与同一次尝试处在同一诊断目录。
     * @param file - 保留文件。
     */ file => path.dirname(file) === failed.directory && file.endsWith('.png')));
    const browser = (await readFile(path.join(failed.directory, 'browser.jsonl'), 'utf8')).trim().split('\n').map(/** 读取真实浏览器落盘事件。
     * @param line - 单条 JSONL。
     */ line => JSON.parse(line));
    for (const level of ['debug','info','log','warn','error']) assert.ok(browser.some(/** 验证导航初期各级 console 均有保存。
     * @param event - 浏览器事件。
     */ event => event.text === `startup-${level}`));
    assert.ok(browser.some(/** 第二个页面仍被同一个公共 context 采集。
     * @param event - 浏览器事件。
     */ event => event.event === 'page.open' && event.pageId === 2));
    assert.ok(browser.some(/** 真实 HTTP 503 有响应状态。
     * @param event - 浏览器事件。
     */ event => event.event === 'http.response' && event.status === 503));
    assert.ok(browser.some(/** 断连明确没有收到响应。
     * @param event - 浏览器事件。
     */ event => event.event === 'http.failed' && event.status === 'unavailable' && event.response === 'not-received'));
    assert.ok(browser.some(/** 保留异常类型。
     * @param event - 浏览器事件。
     */ event => event.errorName === 'TypeError' && event.text === 'controlled-page-error'));
    assert.ok(browser.some(/** 应用已有事件仍保持原逻辑名称。
     * @param event - 浏览器事件。
     */ event => event.event === 'probe.cache' && event.cacheAgeMs === 42));
    assert.equal(await runNode([path.join(root, 'scripts/ci-web-diagnostics.mjs')], environment), 0);
    for (const file of await filesIn(environment.CLRN_DIAGNOSTICS_DIR)) {
      if (!/\.(json|jsonl|md)$/.test(file)) continue;
      const text = await readFile(file, 'utf8');
      for (const secret of ['public-browser-sentinel','public-body-sentinel','public-event-sentinel','public-stdout-sentinel','public-input-sentinel','127.0.0.1']) {
        assert.ok(!text.includes(secret), `${path.basename(file)}: ${secret}`);
      }
    }
    const summary = await readFile(path.join(environment.CLRN_DIAGNOSTICS_DIR, 'README.md'), 'utf8');
    assert.ok(summary.includes('controlled-failure'));
    assert.ok(summary.includes('timedOut'));
    assert.ok(summary.includes('missing-target'));
    assert.ok(summary.includes('controlled-failure-marker'));
  });
