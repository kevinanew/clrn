/** 覆盖默认上下文、手动上下文和 popup；只观察现有输出，不录制网络正文。 */
import type { Request } from '@playwright/test';
import { diagnosticFields, diagnosticNode, diagnosticPath } from './diagnostic-privacy';
import { DiagnosticLog, logError, logText } from './diagnostic-log';
import { DiagnosticRecorder } from './diagnostic-recorder';

// 只声明实际使用的共有能力，避免两套 Playwright 的 Page/BindingSource 类型互相传播。
interface DiagnosticContext {
  pages(): object[];
  exposeBinding(name: string, callback: (source: unknown, fields: unknown) => void): Promise<unknown>;
  addInitScript(script: string): Promise<unknown>;
}

/**
 * 同步安装 context 监听，在调用者开始导航前持续收集。
 * @param context - 新建且尚未导航的浏览器上下文。
 * @param log - 当前用例的持久化出口。
 */
export async function collectBrowserDiagnostics(context: DiagnosticContext, log: DiagnosticLog): Promise<() => void> {
  const recorder = new DiagnosticRecorder(/** 复用既有字段白名单和采集器，早于内存轮转保存每条网络/应用事件。
   * @param event - 已脱敏的采集事件。
   */ event => log.record(event.event, { ...event, origin: event.source || 'browser' }));
  const pending = new Map<Request, { requestId: number; start: number; status?: number }>();
  const pages = new Set<object>();
  const removers: (() => void)[] = [];
  let sequence = 0;
  /**
   * 登记可清理的监听，不改变 Playwright 或应用事件。
   * @param emitter - 上下文或页面。
   * @param event - 固定事件名。
   * @param callback - 采集回调。
   */
  function listen(emitter: object, event: string, callback: (...args: any[]) => void): void {
    const events = emitter as unknown as { on(name: string, listener: (...args: any[]) => void): void;
      off(name: string, listener: (...args: any[]) => void): void };
    events.on(event, callback);
    removers.push(/** 解除本轮测试监听，避免 worker 后续用例混入历史事件。 */ () => events.off(event, callback));
  }
  /**
   * 不记录 URL 参数、实体标识、头部或正文。
   * @param request - 实际浏览器请求。
   */
  function requestFields(request: Request): Record<string, unknown> {
    const entry = pending.get(request);
    const url = new URL(request.url());
    return { requestId: entry?.requestId, method: request.method(), node: diagnosticNode(url.origin),
      path: diagnosticPath(url.pathname), status: entry?.status ?? 'unavailable',
      response: entry?.status === undefined ? 'not-received' : 'received',
      elapsedMs: entry ? Date.now() - entry.start : 0 };
  }
  /**
   * 为新页面记录崩溃和关闭，不读取界面中的输入值。
   * @param page - 已有页面或新 popup。
   */
  function observePage(page: object): void {
    if (pages.has(page)) return;
    pages.add(page);
    const pageId = pages.size;
    log.record('page.open', { pageId });
    listen(page, 'crash', /** 记录页面崩溃。 */ () => log.record('page.crash', { pageId }));
    listen(page, 'close', /** 记录清理阶段的页面关闭。 */ () => log.record('page.close', { pageId }));
  }
  listen(context, 'page', observePage);
  context.pages().forEach(observePage);
  listen(context, 'console', /** 所有级别均采集 text，不展开可能包含凭据的参数对象。
   * @param message - 浏览器 console 输出。
   */ message => log.record('page.console', { level: message.type(), text: logText(message.text()) }));
  listen(context, 'weberror', /** 保留异常类型、可用错误代码及脱敏说明。
   * @param failure - 上下文中任意页面的异常。
   */ failure => log.record('page.error', logError(failure.error())));
  listen(context, 'request', /** 记录请求开始，状态保持未收到。
   * @param request - 实际请求。
   */ request => {
    pending.set(request, { requestId: ++sequence, start: Date.now() });
    recorder.record('http.start', requestFields(request));
  });
  listen(context, 'response', /** 仅在实际响应事件记录 HTTP 状态。
   * @param response - 实际响应。
   */ response => {
    const entry = pending.get(response.request());
    if (entry) entry.status = response.status();
    recorder.record('http.response', requestFields(response.request()));
  });
  listen(context, 'requestfailed', /** 保留网络错误代码，绝不把断连推断成 HTTP 500。
   * @param request - 实际失败请求。
   */ request => {
    recorder.record('http.failed', { ...requestFields(request), ...logError(request.failure()?.errorText) });
    pending.delete(request);
  });
  listen(context, 'requestfinished', /** 释放已完成请求的内存。
   * @param request - 已完成请求。
   */ request => pending.delete(request));
  // 独立绑定名兼容既有 connection-diagnostics；只接收其白名单事件。
  try {
    await context.exposeBinding('__clrnRunDiagnostic', /** 保留构建已有的选线事件。
     * @param _source - Playwright 绑定来源。
     * @param fields - 应用既有事件。
     */ (_source, fields) => {
      const safe = diagnosticFields(fields);
      recorder.record(String(safe.event || 'application.event'), { ...safe, source: 'application' });
    });
    await context.addInitScript(`window.addEventListener('laiwan:connection-diagnostic', event => {
    window.__clrnRunDiagnostic(event.detail).catch(() => {});
  });`);
  } catch (error) { log.record('collection.application-events-unavailable', logError(error)); }
  return /** 收尾时保留未完成请求并解除监听；原有上下文生命周期继续执行。 */ () => {
    for (const request of pending.keys()) recorder.record('http.pending', requestFields(request));
    removers.forEach(/** 释放当前监听。
     * @param remove - 监听清理函数。
     */ remove => remove());
    log.record('collection.stop');
  };
}
