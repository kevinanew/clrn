/** 在导航前安装浏览器和应用事件采集；失败时先保存诊断，再由调用方清理房间。 */
import type { BrowserContext, Page, Request, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { DiagnosticRecorder } from '../../../e2e/helpers/diagnostic-recorder';
import { diagnosticFields, diagnosticNode, diagnosticText } from '../../../e2e/helpers/diagnostic-privacy';

type DiagnosticProxy = { diagnostics?: () => Promise<{ events: unknown[]; dropped: number }> };
const recordings = new WeakMap<Page, DiagnosticRecorder>();

/**
 * 记录真实操作入口；未启用诊断的测试不受影响。
 * @param page - 当前页面。
 * @param phase - 当前阶段或操作。
 * @param fields - 不包含业务正文的辅助信息。
 */
export function recordDiagnostic(page: Page, phase: string, fields: unknown = {}): void {
  recordings.get(page)?.record('test.step', { ...diagnosticFields(fields), phase });
}

/**
 * 记录按钮的几何位置和覆盖它的元素标识，不收集页面完整正文。
 * @param page - 当前页面。
 * @param target - 无法点击的控件标识。
 * @param details - 定位器测得的几何及命中信息。
 */
export function recordBlockedTarget(page: Page, target: string, details: unknown): void {
  recordings.get(page)?.record('ui.blocked', { target, reason: JSON.stringify(details) });
}

/**
 * 安装测试上下文内的诊断收集器，返回保存方法。
 * @param context - 本用例独占的上下文。
 * @param page - 尚未导航的页面。
 * @param info - 当前测试报告。
 * @param proxy - 可提供脱敏运行历史的测试代理。
 */
export async function installConnectionDiagnostics(context: BrowserContext, page: Page, info: TestInfo,
  proxy: DiagnosticProxy = {}) {
  const recorder = new DiagnosticRecorder();
  recordings.set(page, recorder);
  const requests = new Map<Request, { requestId: string; node: string; path: string; method: string; start: number }>();
  const pendingMetadata = new Set<Promise<unknown>>();
  let sequence = 0;
  let applicationEvents = 0;
  await context.exposeBinding('__clrnConnectionDiagnostic', (_source, fields: unknown) => {
    if (applicationEvents++ < 10000) recorder.record(String(diagnosticFields(fields).event || 'application.event'),
      { ...diagnosticFields(fields), source: 'application', observedAt: Date.now() });
  });
  // 用字符串避免 tsx 对浏览器回调注入运行时辅助函数；不改写任何业务网络 API。
  await context.addInitScript(`window.addEventListener('laiwan:connection-diagnostic', event => {
    window.__clrnConnectionDiagnostic(event.detail).catch(() => {});
  });`);
  page.on('request', request => {
    const url = new URL(request.url());
    if (!/^(xhr|fetch|document)$/.test(request.resourceType())) return;
    const entry = { requestId: `http-${++sequence}`, node: diagnosticNode(url.origin), path: url.pathname,
      method: request.method(), start: Date.now() };
    requests.set(request, entry);
    recorder.record('http.start', entry);
  });
  page.on('response', response => {
    const entry = requests.get(response.request());
    if (!entry) return;
    recorder.record('http.response', { ...entry, status: response.status(), elapsedMs: Date.now() - entry.start,
      source: response.fromServiceWorker() ? 'service-worker' : 'browser' });
    // 仅读取节点列表响应；从不收集登录、钱包或游戏请求的正文。
    if (/^\/public\/v1[23]\/metadata\/servers$/.test(entry.path)) {
      const reading = response.json().then(body => {
        const servers = body?.result?.servers;
        if (!servers || typeof servers !== 'object') return;
        const names = Array.isArray(servers) ? servers : Object.keys(servers);
        recorder.record('nodes.received', { ...entry, candidates: names.filter(name => typeof name === 'string').map(diagnosticNode) });
      }).catch(() => recorder.record('nodes.unreadable', entry));
      pendingMetadata.add(reading);
      void reading.finally(() => pendingMetadata.delete(reading));
    }
  });
  page.on('requestfinished', request => {
    const entry = requests.get(request);
    if (entry) recorder.record('http.finished', { ...entry, elapsedMs: Date.now() - entry.start });
    requests.delete(request);
  });
  page.on('requestfailed', request => {
    const entry = requests.get(request);
    if (entry) recorder.record('http.failed', { ...entry, elapsedMs: Date.now() - entry.start,
      reason: request.failure()?.errorText || 'unknown' });
    requests.delete(request);
  });
  page.on('websocket', socket => {
    const url = new URL(socket.url());
    const connection = { connectionId: `socket-${++sequence}`, node: diagnosticNode(url.origin), path: url.pathname };
    recorder.record('websocket.start', connection);
    socket.on('socketerror', reason => recorder.record('websocket.error', { ...connection, reason }));
    socket.on('close', () => recorder.record('websocket.closed', connection));
    // 不保存原始消息：认证与业务正文可能包含凭据；订阅及 RPC 概要由应用/代理提供。
  });
  page.on('pageerror', error => recorder.record('page.error', { reason: diagnosticText(error.stack || error.message) }));
  page.on('crash', () => recorder.record('page.crash'));
  return {
    recorder,
    /**
     * 在清理之前保存全部脱敏事件，并将短摘要附到 Playwright 报告。
     * @param failure - 触发保存的原始错误；正常完成时省略。
     */
    async save(failure?: unknown): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([...pendingMetadata]), new Promise<void>(resolve => {
        timer = setTimeout(resolve, 2000);
      })]);
      clearTimeout(timer);
      recorder.record(failure ? 'test.failure' : 'test.complete',
        { reason: failure instanceof Error ? failure.message : failure === undefined ? '' : String(failure) });
      for (const entry of requests.values()) recorder.record('http.pending', { ...entry, elapsedMs: Date.now() - entry.start });
      if (proxy.diagnostics) {
        try {
          const history = await proxy.diagnostics();
          recorder.merge(history.events, history.dropped);
        } catch (error) { recorder.record('proxy.diagnostics-unavailable', { reason: String(error) }); }
      }
      const title = `${info.title} / ${info.project.name} / repeat ${info.repeatEachIndex} / retry ${info.retry}`;
      const summary = recorder.markdown(title);
      const diagnosticPath = info.outputPath('connection-diagnostics.json');
      await writeFile(diagnosticPath, JSON.stringify(recorder.snapshot(), null, 2));
      await writeFile(info.outputPath('connection-summary.md'), summary);
      await info.attach('connection-diagnostics', { path: diagnosticPath, contentType: 'application/json' });
      await info.attach('connection-summary', { body: summary, contentType: 'text/markdown' });
      if (failure) console.log(summary);
    },
  };
}
