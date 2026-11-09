/** 真实 Chromium 验证固定加载器的 CDP 回调边界、失败语义及附件脱敏。 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium, type TestInfo } from '@playwright/test';
import { installCardSpriteLoader, loaderMethod, loaderAbortMethod } from './cardSpriteLoader';

const commit = '69f9251d3b5f2b93aa2d880d27abbeefe16ee645';

test('加载器取证记录实际成功回调并保留同步返回值、接收者及原始异常', /** 验证加载器取证记录实际成功回调并保留同步返回值、接收者及原始异常。 */ async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-loader-'));
  const environment = { root: process.env.CLRN_RELEASE_WEB_ROOT, commit: process.env.CLRN_EXPECTED_APPLICATION_COMMIT };
  const browser = await chromium.launch({ ...(process.env.DIAGNOSTIC_CHROME_PATH
    ? { executablePath: process.env.DIAGNOSTIC_CHROME_PATH } : {}) });
  try {
    process.env.CLRN_RELEASE_WEB_ROOT = directory;
    process.env.CLRN_EXPECTED_APPLICATION_COMMIT = commit;
    await writeFile(path.join(directory, 'fixture.js'), 'var n=0,o={};window.loader={' + loaderAbortMethod + ',' + loaderMethod + '};');
    await writeFile(path.join(directory, 'index.html'), '<script src="fixture.js"></script>');
    const page = await browser.newPage();
    const info = {
      /**
       * 将取证文件放进可清理的临时目录。
       * @param name - 附件名。
       */
      outputPath: (name: string) => path.join(directory, name),
      /** 此回归直接验证文件，不依赖 HTML 报告。 */
      attach: async () => {},
    } as unknown as TestInfo;
    const finish = await installCardSpriteLoader(page, info);
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
    await page.evaluate(/** 发起一个有效图片加载和一个被取消的加载，核验加载器回调行为。 */ () => {
      const state = window as typeof window & { loader: { load: (source: string, callback: () => void) => number; abort: (request: number) => void }; called?: boolean };
      state.loader.load('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/%3E',
        /** 标记有效图片的加载回调已执行。 */ () => { state.called = true; });
      const aborted = state.loader.load('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="5"/%3E',
        /** 若取消后的图片回调仍执行则立即失败。 */ () => { throw new Error('aborted callback must not run'); });
      state.loader.abort(aborted);
    });
    await page.waitForFunction(/** 等待有效图片的加载回调完成。 */ () => (window as typeof window & { called?: boolean }).called);
    // 这两次只验证包装透明性，不冒充真实应用回调；实际加载调用已在上面取得。
    assert.equal(await page.evaluate(/** 验证图片加载回调包装器保留接收者、参数、返回值与抛出异常。 */ () => {
      const state = window as typeof window & { __clrnObserveImageLoader: (callback: (...args: unknown[]) => unknown,
        request: number, resource: string) => (...args: unknown[]) => unknown };
      const receiver = {};
      const result = {};
      const failure = new Error('fixture-private-secret');
      const wrapped = state.__clrnObserveImageLoader(/** 核对回调接收者和参数后返回同一个结果对象。
 * @param value - 当前待转换或校验的值。 */ function(this: unknown, value) {
        if (this !== receiver || value !== result) throw failure;
        return result;
      }, 100, '/assets/probe.example.invalid/token=fixture-private-secret');
      if (wrapped.call(receiver, result) !== result) return false;
      const unbound = state.__clrnObserveImageLoader(/** 在严格模式返回当前接收者，验证包装器保留 undefined 接收者。 */ function(this: unknown) { 'use strict'; return this; },
        102, '/assets/strict-callback');
      if (unbound() !== undefined) return false;
      const throwing = state.__clrnObserveImageLoader(/** 抛出预设错误对象，验证包装器按原样传播异常。 */ () => { throw failure; }, 101,
        '/assets/192.0.2.7/fixture-private-secret');
      try { throwing(); return false; } catch (error) { return error === failure; }
    }), true);
    await finish();
    const contents = await readFile(path.join(directory, 'card-sprite-loader.jsonl'), 'utf8');
    const events = contents.trim().split('\n').map(/** 解析图集加载器事件日志，核对各请求的处理阶段。
 * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
    assert.deepEqual(events.filter(/** 提取首个图集请求的事件，验证初次加载流程。
 * @param event - 当前触发的事件。 */ event => event.request === 1).map(/** 提取首个请求的阶段名，核对加载器生命周期。
 * @param event - 当前触发的事件。 */ event => event.phase), ['registered', 'native-load', 'enter', 'return']);
    assert.deepEqual(events.filter(/** 提取第二个图集请求的事件，核对请求替换行为。
 * @param event - 当前触发的事件。 */ event => event.request === 2).map(/** 提取第二个请求的阶段名，核对加载器重试顺序。
 * @param event - 当前触发的事件。 */ event => event.phase), ['registered', 'abort']);
    assert.deepEqual(events.filter(/** 提取编号 101 的图集请求，核对并发请求的独立状态。
 * @param event - 当前触发的事件。 */ event => event.request === 101).map(/** 提取并发请求的阶段名，检查事件未被其他请求覆盖。
 * @param event - 当前触发的事件。 */ event => event.phase), ['registered', 'enter', 'throw']);
    assert.doesNotMatch(contents, /fixture-private-secret|example\.invalid|192\.0\.2\.7|data:image|base64/);
    assert.match(contents, /asset-[a-f0-9]{16}/);
    assert.deepEqual(events.slice(1).map(/** 提取加载事件序号，核对日志写入顺序。
 * @param event - 当前触发的事件。 */ event => event.sequence), events.slice(1).map(/** 生成连续的预期序号，检查加载器日志是否完整。
 * @param _event - 当前操作使用的 _event。
 * @param index - 当前条目在集合中的位置。 */ (_event, index) => index + 1));
    await writeFile(path.join(directory, 'fixture.js'), 'window.loader={};');
    await assert.rejects(installCardSpriteLoader(await browser.newPage(), info), /未唯一识别/);
  } finally {
    if (environment.root === undefined) delete process.env.CLRN_RELEASE_WEB_ROOT;
    else process.env.CLRN_RELEASE_WEB_ROOT = environment.root;
    if (environment.commit === undefined) delete process.env.CLRN_EXPECTED_APPLICATION_COMMIT;
    else process.env.CLRN_EXPECTED_APPLICATION_COMMIT = environment.commit;
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
