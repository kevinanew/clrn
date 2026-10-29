import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

const repository = path.resolve(__dirname, '../..');
const resolve = createRequire(path.join(repository, 'package.json')).resolve;
const cli = resolve('@playwright/test/cli');
type Collected = { file: string; title: string; project: string };

/**
 * 展开真实 Playwright JSON 收集报告，保留项目及重复条目。
 * @param suites - 实际配置收集出的文件和嵌套套件。
 */
function collectedTests(suites: JSONReportSuite[]): Collected[] {
  return suites.flatMap(suite => [
    ...suite.specs.flatMap(spec => spec.tests.map(item => ({
      file: path.basename(spec.file), title: spec.title, project: item.projectName,
    }))),
    ...collectedTests(suite.suites ?? []),
  ]);
}

/**
 * 只执行实际 CLI 收集，不启动浏览器、登录、代理或业务请求。
 * @param config - 仓库中的正式配置路径。
 * @param repeats - 收集每项用例的重复次数。
 */
function collect(config: string, repeats = 1): Collected[] {
  const result = spawnSync(process.execPath, [cli, 'test', `--config=visual/animations/${config}`,
    '--list', '--reporter=json', `--repeat-each=${repeats}`], {
    cwd: repository, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: '', PLAYWRIGHT_JSON_OUTPUT_DIR: '',
      PLAYWRIGHT_JSON_OUTPUT_NAME: '' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as JSONReport;
  assert.deepEqual(report.errors, []);
  return collectedTests(report.suites);
}

// 原普通配置的覆盖清单：两种视口均保留，只有旧搜索提示仅限手机。
const ordinary: Record<string, string[]> = {
  'ambient.spec.ts': ['launch branding fades in', '大厅老虎机横幅自动旋转并重复'],
  'application.spec.ts': ['guest search confirmation enter and exit', 'club more menu enter and exit',
    'private room invitation bottom sheet enter and exit', 'create room game picker enter and exit',
    'club rooms empty state fades in', 'hall matching spinner modal enter and exit'],
  'dialogs.spec.ts': ['staging notice fades and scales in on launch', 'share link confirmation dialog enter and exit'],
  'search-prompt.spec.ts': ['en mobile guest search prompt fades in'],
  'skeleton.spec.ts': ['club list placeholders pulse while details are pending'],
  'slot.spec.ts': ['老虎机滚轮和三种奖励动画'],
  'slotPopups.spec.ts': ['slot panel and no-energy dialog enter and exit'],
  'texas.spec.ts': ['texas panels animations', 'texas gameplay animations', 'texas social animations',
    'texas assets animations', 'texas hall panel animations'],
  'zhajinhua.spec.ts': ['zhajinhua panels animations', 'zhajinhua gameplay animations'],
};

test('普通动画实际收集保留全部原用例及桌面搜索排除，双视口均不收集独立对照', () => {
  const actual = collect('playwright.config.ts');
  const expected = ['mobile', 'desktop'].flatMap(project => Object.entries(ordinary)
    .filter(([file]) => project !== 'desktop' || file !== 'search-prompt.spec.ts')
    .flatMap(([file, titles]) => titles.map(title => ({ file, title, project }))));
  assert.deepEqual(actual.map(item => JSON.stringify(item)).sort(), expected.map(item => JSON.stringify(item)).sort());
});

test('独立配置实际收集双视口的两项对照及三遍重复，不继承普通项目的对照排除', () => {
  for (const repeats of [1, 3]) {
    const actual = collect('cardSpriteControl.config.ts', repeats);
    const expected = ['mobile', 'desktop'].flatMap(project => Array.from({ length: repeats }, () =>
      [0, 1].map(position => ({ file: 'cardSpriteControl.spec.ts',
        title: `independent card sprite clock ${position}`, project })))).flat();
    assert.deepEqual(actual.map(item => JSON.stringify(item)).sort(), expected.map(item => JSON.stringify(item)).sort());
  }
});
