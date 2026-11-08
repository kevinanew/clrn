/** 真实 Playwright CLI 的 body/path 附件与后续清理验收，不依赖浏览器启动权限。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

for (const project of ['e2e', 'visual']) test(`${project} 真实 runner 保全内存 PNG、路径图片和连接摘要，后续命令清理不丢失`,
  /** 从 CLI 原始失败到最终清单逐字节校验，不能只验证 reporter 方法被调用。
   * @param context - 测试清理接口。
   */ context => {
    const directory = mkdtempSync(path.join(tmpdir(), 'clrn-cli-attachments-'));
    context.after(/** 清理仅含公开图片与哨兵的受控失败产物。 */ () => rmSync(directory, { recursive: true, force: true }));
    const root = path.resolve(__dirname, '../..');
    const image = new PNG({ width: 2, height: 2 });
    image.data.fill(255);
    const png = PNG.sync.write(image);
    const reference = path.join(directory, 'reference.png');
    writeFileSync(reference, png);
    const wrapper = path.join(root, project === 'e2e' ? 'e2e/helpers/diagnostic-test.ts' : 'visual/src/support/diagnosticTest.ts');
    const configuration = path.join(directory, 'playwright.config.cjs');
    const outputDir = path.join(directory, 'results');
    writeFileSync(configuration, `module.exports={testDir:__dirname,testMatch:'attachments.spec.ts',workers:1,retries:0,
      outputDir:${JSON.stringify(outputDir)},reporter:[[${JSON.stringify(path.join(root, 'e2e/helpers/diagnostic-reporter.ts'))}]],
      projects:[{name:'attachment-mobile',use:{viewport:{width:375,height:812}}}],use:{trace:'off'}};`);
    writeFileSync(path.join(directory, 'attachments.spec.ts'), `import {test} from ${JSON.stringify(wrapper)};
      import {readFileSync,writeFileSync} from 'node:fs';
      test('original-attachment-failure',async({},info)=>{
        const png=readFileSync(${JSON.stringify(reference)});
        await info.attach('内存截图',{body:png,contentType:'image/png'});
        const file=info.outputPath('original.png');writeFileSync(file,png);
        await info.attach('路径截图',{path:file,contentType:'image/png'});
        await info.attach('connection-summary',{body:'HTTP 503',contentType:'text/markdown'});
        await info.attach('storage-state',{body:'public-forbidden-attachment-body',contentType:'application/json'});
        throw new Error('original-attachment-failure-marker');
      });
      test('later-success',async()=>{});`);
    const cli = createRequire(path.join(root, project, 'package.json')).resolve('@playwright/test/cli');
    const diagnostics = path.join(directory, 'diagnostics');
    const environment = { ...process.env, CLRN_DIAGNOSTICS_DIR: diagnostics, GITHUB_STEP_SUMMARY: '' };
    const first = spawnSync(process.execPath, [cli, 'test', '--config', configuration, '--grep', 'original-attachment-failure'],
      { env: environment, encoding: 'utf8', timeout: 30000 });
    assert.equal(first.status, 1, first.stderr);
    const cases = readdirSync(diagnostics, { recursive: true, withFileTypes: true }).filter(
      /** 只定位真实运行器已关联的用例身份。
       * @param entry - 诊断目录条目。
       */ entry => entry.name === 'case.json');
    assert.equal(cases.length, 1);
    const caseDirectory = cases[0].parentPath;
    const item = JSON.parse(readFileSync(path.join(caseDirectory, 'case.json'), 'utf8'));
    assert.equal(item.status, 'failed');
    assert.equal(item.project, 'attachment-mobile');
    const steps = readFileSync(path.join(caseDirectory, 'steps.jsonl'), 'utf8');
    assert.ok(steps.includes('original-attachment-failure-marker'), steps);
    const originalFiles = readdirSync(outputDir, { recursive: true });
    assert.ok(originalFiles.some(/** 原始路径图片必须实际存在，后续命令才有清理效果。
     * @param file - 测试输出路径。
     */ file => String(file).endsWith('original.png')));
    const later = spawnSync(process.execPath, [cli, 'test', '--config', configuration, '--grep', 'later-success'],
      { env: environment, encoding: 'utf8', timeout: 30000 });
    assert.equal(later.status, 0, later.stderr);
    assert.ok(!readdirSync(outputDir, { recursive: true }).some(/** 确认旧报告已由真实 CLI 清空。
     * @param file - 当前测试输出路径。
     */ file => String(file).endsWith('original.png')));
    execFileSync(process.execPath, [path.join(root, 'scripts/ci-web-diagnostics.mjs')], { env: environment });
    const events = readFileSync(path.join(caseDirectory, 'timeline.jsonl'), 'utf8').trim().split('\n').map(
      /** 检查最终下载包的关联记录。
       * @param line - 已脱敏时间线。
       */ line => JSON.parse(line));
    const attachments = events.filter(/** 仅获取实际已保全附件。
     * @param event - 持久化事件。
     */ event => event.event === 'test.attachment');
    assert.deepEqual(attachments.map(/** 验证禁止附件没有混入关联记录。
     * @param event - 附件关联。
     */ event => event.name), ['内存截图', '路径截图', 'connection-summary']);
    for (const attachment of attachments.slice(0, 2)) {
      assert.deepEqual(readFileSync(path.join(caseDirectory, attachment.file)), png);
    }
    assert.equal(readFileSync(path.join(caseDirectory, attachments[2].file), 'utf8'), 'HTTP 503');
    assert.equal(JSON.parse(readFileSync(path.join(caseDirectory, 'case.json'), 'utf8')).status, 'failed');
    const manifest = JSON.parse(readFileSync(path.join(diagnostics, 'manifest.json'), 'utf8'));
    assert.equal(manifest.cases, 2);
    for (const attachment of attachments) assert.ok(manifest.files.some(/** 汇总清单包含原失败用例的附件。
     * @param entry - 最终文件清单条目。
     */ (entry: { file: string }) => entry.file === path.relative(diagnostics, path.join(caseDirectory, attachment.file))));
    assert.ok(readFileSync(path.join(diagnostics, 'README.md'), 'utf8').includes('original-attachment-failure'));
  });
