/** 保护认证缓存、游客白名单与场景语言在上下文创建和脚本注入两阶段的隔离。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { BrowserContext, Page } from '@playwright/test';
import { bindScenarioProxy } from '../../../e2e/helpers/scenario-proxy';
import type { Mitmproxy } from '../../../e2e/helpers/mitmproxy-client';
import { LANGUAGE_STORAGE_KEY, type VisualScenario } from '../../scenarioTypes';
import { buildStorageStateForScenario, readAuthStateEntries, setupContextForScenario } from './pageSetup';

const entries = {
  'save.user.origin.data.from.server.key': JSON.stringify({ user_id: 'isolated-user' }),
  'app.theme.id.key': 'dark',
  [LANGUAGE_STORAGE_KEY]: 'cached-language',
  privateCache: 'account-only',
};
type Script = { source: string; argument: unknown };

/** 捕获真实初始化脚本，不替换缓存选择实现。
 * @param scripts - 当前上下文的脚本记录。 */
function scriptContext(scripts: Script[]): BrowserContext {
  return {
    /** 保存函数序列化结果及真实参数。
     * @param script - 浏览器初始化函数或脚本。
     * @param argument - 本次注入参数。 */
    async addInitScript(script: string | ((argument: unknown) => void), argument?: unknown) {
      scripts.push({ source: typeof script === 'string' ? script : `(${script.toString()})(argument)`, argument });
    },
  } as unknown as BrowserContext;
}

/** 在独立浏览器全局依序执行脚本，确认没有外部编译辅助依赖。
 * @param scripts - 实际注册的脚本。
 * @param storage - 当前页面缓存。 */
function applyScripts(scripts: Script[], storage: Map<string, string>): void {
  const window = { localStorage: {
    /** 模拟浏览器存储写入。
     * @param key - 存储键。
     * @param value - 存储值。 */
    setItem(key: string, value: string) { storage.set(key, value); },
  } };
  for (const script of scripts) runInNewContext(script.source, { window, argument: script.argument });
}

for (const signIn of [false, true]) {
  test(`signIn=${signIn} 创建阶段和脚本注入均隔离缓存并保留场景语言`, /** 游客只共享主题，登录场景保留完整认证缓存。
   * @param context - 当前测试的隔离 mock 生命周期。 */ async context => {
    context.mock.method(fs, 'readFileSync', /** 注入本轮采集缓存。 */ () => JSON.stringify({ entries }));
    const scenario = { signIn, locale: 'zh-Hant', deviceId: 'scene-device', pageLabel: 'hall' } as VisualScenario;
    const state = buildStorageStateForScenario(scenario, 'https://app.test/path');
    assert.ok(state && typeof state !== 'string');
    assert.equal(state.origins[0].origin, 'https://app.test');
    const storage = new Map(state.origins[0].localStorage.map(/** 读取真实上下文存储参数。
     * @param entry - 本次写入项。 */ entry => [entry.name, entry.value]));
    assert.equal(storage.get(LANGUAGE_STORAGE_KEY), scenario.locale);
    assert.equal(storage.get('deviceId'), scenario.deviceId);
    assert.equal(storage.get('app.theme.id.key'), 'dark');
    assert.equal(storage.has('privateCache'), signIn);
    assert.equal(storage.has('save.user.origin.data.from.server.key'), signIn);

    const scripts: Script[] = [];
    const pageScripts: Script[] = [];
    const browser = scriptContext(scripts);
    bindScenarioProxy(browser, { command: /** 透传场景不替换任何响应。 */ async () => {} } as unknown as Mitmproxy);
    await setupContextForScenario(browser, scenario, scriptContext(pageScripts) as unknown as Page, { animations: 'allow' });
    const injected = new Map<string, string>();
    applyScripts(scripts, injected);
    applyScripts(pageScripts, injected);
    assert.equal(pageScripts.length, Number(signIn));
    assert.deepEqual(injected, storage);
  });
}

for (const raw of ['{', 'null', '{}', '{"entries":null}', '{"entries":{}}', '{"entries":"invalid"}']) {
  test(`无效采集文件 ${raw} 不注入认证缓存`, /** 保留损坏文件的显式缺失语义。
   * @param context - 本测试 mock 生命周期。 */ context => {
    context.mock.method(fs, 'readFileSync', /** 返回当前无效采集文件。 */ () => raw);
    assert.equal(readAuthStateEntries(), null);
  });
}
