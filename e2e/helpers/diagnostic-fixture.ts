/** 两个 Playwright 安装各自扩展其 test，复用相同日志实现，避免加载另一版本运行器。 */
import type { test as playwrightTest } from '@playwright/test';
import path from 'node:path';
import { collectBrowserDiagnostics } from './browser-diagnostics';
import { DiagnosticLog, diagnosticCaseDirectory, diagnosticDirectory, logError } from './diagnostic-log';

type Recording = { log: DiagnosticLog; stops: (() => void)[] };

/**
 * 自动 fixture 早于页面、账号和代理 fixture 安装，并在它们清理后结束。
 * @param base - 调用子项目自己的 Playwright test。
 */
export function diagnosticTest<T extends { extend: unknown }>(base: T): T {
  // 实现只使用两版本共有能力；返回调用方的完整 test 类型，避免跨安装传播 Page/expect 类型。
  const runtimeBase = base as unknown as typeof playwrightTest;
  let active: Recording | undefined;
  return runtimeBase.extend<{ runDiagnostics: void }>({
    /**
     * 保持 browser 的 worker scope 和按需启动，纯 API 用例无需安装或启动浏览器。
     * @param fixtures - 原版 browser worker fixture。
     * @param use - 原有浏览器生命周期。
     * @param info - 当前 worker 身份。
     */
    browser: async ({ browser }, use, info) => {
      const original = browser.newContext;
      let setup: Recording | undefined;
      browser.newContext = /** 在任意 newContext 返回前安装采集，覆盖默认页面及手动登录上下文。
       * @param options - 原始上下文选项，不进入日志。
       */ async options => {
        const recording = active || (setup ??= { log: new DiagnosticLog(
          path.join(diagnosticDirectory(), `setup-worker-${info.workerIndex}`), 'browser'), stops: [] });
        const context = await original.call(browser, options);
        try { recording.stops.push(await collectBrowserDiagnostics(context, recording.log)); }
        catch (error) { recording.log.record('collection.unavailable', logError(error)); }
        return context;
      };
      try { await use(browser); }
      finally {
        browser.newContext = original;
        setup?.stops.forEach(/** 收尾 beforeAll/afterAll 中的准备上下文。
         * @param stop - 准备阶段采集器。
         */ stop => stop());
      }
    },
    runDiagnostics: [/** 为所有手动和默认上下文安装采集，保持原创建和退出行为。
     * @param fixtures - 不依赖浏览器的自动采集生命周期。
     * @param use - 原始测试生命周期。
     * @param info - 当前用例、重试和设备身份。
     */ async ({}, use, info) => {
      const log = new DiagnosticLog(diagnosticCaseDirectory(info), 'browser');
      const previousCase = process.env.CLRN_DIAGNOSTIC_CASE;
      process.env.CLRN_DIAGNOSTIC_CASE = log.directory;
      const stops: (() => void)[] = [];
      active = { log, stops };
      try { await use(); }
      finally {
        stops.forEach(/** 收尾现有上下文的持久化采集。
         * @param stop - 当前上下文收尾函数。
         */ stop => stop());
        log.record('test.end', { status: info.status });
        log.record('collection.end', { contexts: stops.length, availability: stops.length ? 'observed' : 'browser-not-requested-or-unavailable' });
        active = undefined;
        if (previousCase === undefined) delete process.env.CLRN_DIAGNOSTIC_CASE;
        else process.env.CLRN_DIAGNOSTIC_CASE = previousCase;
        try { await info.attach('browser-diagnostics', { path: `${log.directory}/browser.jsonl`, contentType: 'application/x-ndjson' }); }
        catch (error) { log.record('collection.attachment-unavailable', logError(error)); }
      }
    }, { auto: true }],
  }) as unknown as T;
}
