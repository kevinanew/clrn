import { launchAnimationBrowser, restoreAnimationEnvironment } from './appSessionBrowser';
/** 真实 Chromium 验证固定加载器的 CDP 回调边界、失败语义及附件脱敏。 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { type TestInfo } from '@playwright/test';
import { installCardSpriteLoader, loaderMethod, loaderAbortMethod } from './cardSpriteLoader';
const commit = '69f9251d3b5f2b93aa2d880d27abbeefe16ee645';
test('加载器取证记录实际成功回调并保留同步返回值、接收者及原始异常', /** 验证加载器取证记录实际成功回调并保留同步返回值、接收者及原始异常。 */ async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-loader-'));
  const environment = { root: process.env.CLRN_RELEASE_WEB_ROOT, commit: process.env.CLRN_EXPECTED_APPLICATION_COMMIT };
  const browser = await launchAnimationBrowser();
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
      attach: async () => { },
    } as unknown as TestInfo;
    const finish = await installCardSpriteLoader(page, info);
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
    await page.evaluate(/** 发起一个有效图片加载和一个被取消的加载，核验加载器回调行为。 */ () => {
      const state = window as typeof window & {
        loader: {
          load: (source: string, callback: () => void) => number;
          abort: (request: number) => void;
        };
        called?: boolean;
      };
      state.loader.load('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/%3E',
      /** 标记有效图片的加载回调已执行。 */ () => { state.called = true; });
      const aborted = state.loader.load('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="5"/%3E',
      /** 若取消后的图片回调仍执行则立即失败。 */ () => { throw new Error('aborted callback must not run'); });
      state.loader.abort(aborted);
    });
    await page.waitForFunction(/** 等待有效图片的加载回调完成。 */ () => (window as typeof window & {
      called?: boolean;
    }).called);
    // 这两次只验证包装透明性，不冒充真实应用回调；实际加载调用已在上面取得。
    assert.equal(await page.evaluate(/** 验证图片加载回调包装器保留接收者、参数、返回值与抛出异常。 */ () => {
      const failureCheck = {
        /** 验证包装器按原对象传播异常。 */
        propagatesFailure(): boolean {
          const throwing = state.__clrnObserveImageLoader(/** 抛出预设错误对象，验证包装器按原样传播异常。 */ () => { throw failure; }, 101, '/assets/192.0.2.7/fixture-private-secret');
          try {
            throwing();
            return false;
          }
          catch (error) {
            return error === failure;
          }
        }
      };
      const state = window as typeof window & {
        __clrnObserveImageLoader: (callback: (...args: unknown[]) => unknown, request: number, resource: string) => (...args: unknown[]) => unknown;
      };
      const receiver = {};
      const result = {};
      const failure = new Error('fixture-private-secret');
      const wrapped = state.__clrnObserveImageLoader(/** 核对回调接收者和参数后返回同一个结果对象。
    * @param value - 当前待转换或校验的值。 */ function (this: unknown, value) {
        if (this !== receiver || value !== result)
          throw failure;
        return result;
      }, 100, '/assets/probe.example.invalid/token=fixture-private-secret');
      const checks = {
        /** 验证包装器仍返回同一个对象。 */
        returned() { return wrapped.call(receiver, result) === result; },
        /** 验证严格模式的 undefined 接收者不被替换。 */
        unboundReceiver() { return unbound() === undefined; },
      };
      if (!checks.returned())
        return false;
      const unbound = state.__clrnObserveImageLoader(/** 在严格模式返回当前接收者，验证包装器保留 undefined 接收者。 */ function (this: unknown) {
        'use strict';
        return this;
      }, 102, '/assets/strict-callback');
      return checks.unboundReceiver() && failureCheck.propagatesFailure();
    }), true);
    await finish();
    const contents = await readFile(path.join(directory, 'card-sprite-loader.jsonl'), 'utf8');
    const events = contents.trim().split('\n').map(/** 将当前条目映射为`JSON.parse(line)`。
   * @param line - 当前操作使用的 line。 */ line => JSON.parse(line));
    assert.deepEqual(events.filter(/** 仅保留满足以下条件的条目：`event.request === 1`。
   * @param event - 当前触发的事件。 */ event => event.request === 1).map(/** 将当前条目映射为`event.phase`。
     * @param event - 当前触发的事件。 */ event => event.phase), ['registered', 'native-load', 'enter', 'return']);
    assert.deepEqual(events.filter(/** 仅保留满足以下条件的条目：`event.request === 2`。
   * @param event - 当前触发的事件。 */ event => event.request === 2).map(/** 将当前条目映射为`event.phase`。
     * @param event - 当前触发的事件。 */ event => event.phase), ['registered', 'abort']);
    assert.deepEqual(events.filter(/** 仅保留满足以下条件的条目：`event.request === 101`。
   * @param event - 当前触发的事件。 */ event => event.request === 101).map(/** 将当前条目映射为`event.phase`。
     * @param event - 当前触发的事件。 */ event => event.phase), ['registered', 'enter', 'throw']);
    assert.doesNotMatch(contents, /fixture-private-secret|example\.invalid|192\.0\.2\.7|data:image|base64/);
    assert.match(contents, /asset-[a-f0-9]{16}/);
    assert.deepEqual(events.slice(1).map(/** 将当前条目映射为`event.sequence`。
   * @param event - 当前触发的事件。 */ event => event.sequence), events.slice(1).map(/** 将当前条目映射为`index + 1`。
     * @param _event - 当前操作使用的 _event。
     * @param index - 当前条目在集合中的位置。 */ (_event, index) => index + 1));
    await writeFile(path.join(directory, 'fixture.js'), 'window.loader={};');
    await assert.rejects(installCardSpriteLoader(await browser.newPage(), info), /未唯一识别/);
  }
  finally {
    restoreAnimationEnvironment('CLRN_RELEASE_WEB_ROOT', environment.root);
    restoreAnimationEnvironment('CLRN_EXPECTED_APPLICATION_COMMIT', environment.commit);
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
