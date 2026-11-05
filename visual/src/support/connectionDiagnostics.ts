/** 在导航前安装浏览器和应用事件采集；失败时先保存诊断，再由调用方清理房间。 */
import type { Request, TestInfo } from '@playwright/test';
import { safeDiagnosticReason } from '../../../scripts/request-failure.cjs';
import { writeFile } from 'node:fs/promises';
import { DiagnosticRecorder } from '../../../e2e/helpers/diagnostic-recorder';
import { diagnosticFields, diagnosticNode } from '../../../e2e/helpers/diagnostic-privacy';

type DiagnosticProxy = { diagnostics?: () => Promise<{ events: unknown[]; dropped: number }> };
// 两套 Playwright 独立安装；共享采集器只依赖实际调用的能力，避免完整对象类型跨版本传播。
type DiagnosticRequest = Pick<Request, 'url' | 'resourceType' | 'method' | 'failure'>;
interface DiagnosticResponse {
  request(): DiagnosticRequest;
  status(): number;
  fromServiceWorker(): boolean;
  json(): Promise<any>;
}
interface DiagnosticSocket {
  url(): string;
  on(event: 'socketerror', listener: (reason: string) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
}
interface DiagnosticPage {
  on(event: 'request' | 'requestfinished' | 'requestfailed', listener: (request: DiagnosticRequest) => void): unknown;
  on(event: 'response', listener: (response: DiagnosticResponse) => void): unknown;
  on(event: 'websocket', listener: (socket: DiagnosticSocket) => void): unknown;
  on(event: 'pageerror', listener: (error: Error) => void): unknown;
  on(event: 'crash', listener: () => void): unknown;
}
interface DiagnosticContext {
  exposeBinding(name: string, callback: (source: unknown, fields: unknown) => void): Promise<unknown>;
  addInitScript(script: string): Promise<unknown>;
}
type DiagnosticInfo = Pick<TestInfo, 'title' | 'repeatEachIndex' | 'retry' | 'outputPath' | 'attach'>
  & { project: { name: string } };
const recordings = new WeakMap<object, DiagnosticRecorder>();

/**
 * 记录真实操作入口；未启用诊断的测试不受影响。
 * @param page - 当前页面。
 * @param phase - 当前阶段或操作。
 * @param fields - 不包含业务正文的辅助信息。
 */
export function recordDiagnostic(page: object, phase: string, fields: unknown = {}): void {
  recordings.get(page)?.record('test.step', { ...diagnosticFields(fields), phase });
}

/**
 * 记录按钮的几何位置和覆盖它的元素标识，不收集页面完整正文。
 * @param page - 当前页面。
 * @param target - 无法点击的控件标识。
 * @param details - 定位器测得的几何及命中信息。
 */
export function recordBlockedTarget(page: object, target: string, details: unknown): void {
  recordings.get(page)?.record('ui.blocked', { target, reason: JSON.stringify(details) });
}

/**
 * 安装测试上下文内的诊断收集器，返回保存方法。
 * @param context - 本用例独占的上下文。
 * @param page - 尚未导航的页面。
 * @param info - 当前测试报告。
 * @param proxy - 可提供脱敏运行历史的测试代理。
 */
export async function installConnectionDiagnostics(context: DiagnosticContext, page: DiagnosticPage, info: DiagnosticInfo,
  proxy: DiagnosticProxy = {}) {
  const recorder = new DiagnosticRecorder();
  recordings.set(page, recorder);
  const requests = new Map<DiagnosticRequest, { requestId: string; node: string; path: string; operation: string; method: string; start: number; status?: number }>();
  const pendingMetadata = new Set<Promise<unknown>>();
  let sequence = 0;
  let applicationEvents = 0;
  await context.exposeBinding('__clrnConnectionDiagnostic', /** 限量接收页面诊断事件并附加来源与宿主观测时间。
 * @param _source - 当前操作使用的 _source。
 * @param fields - 当前操作使用的 fields。 */ (_source, fields: unknown) => {
    if (applicationEvents++ < 10000) recorder.record(String(diagnosticFields(fields).event || 'application.event'),
      { ...diagnosticFields(fields), source: 'application', observedAt: Date.now() });
  });
  // 用字符串避免 tsx 对浏览器回调注入运行时辅助函数；不改写任何业务网络 API。
  await context.addInitScript(`window.addEventListener('laiwan:connection-diagnostic', event => {
    window.__clrnConnectionDiagnostic(event.detail).catch(() => {});
  });`);
  page.on('request', /** 为页面请求分配标识，记录脱敏节点、路径与开始时间。
 * @param request - 当前发出的接口请求。 */ request => {
    const url = new URL(request.url());
    const entry = { requestId: `http-${++sequence}`, node: diagnosticNode(url.origin), path: /^(xhr|fetch|document)$/.test(request.resourceType()) ? url.pathname : '',
      operation: /^(xhr|fetch)$/.test(request.resourceType()) ? 'browser-api-request' : 'browser-resource-read',
      method: request.method(), start: Date.now() };
    requests.set(request, entry);
    recorder.record('http.start', { ...entry, status: 'unavailable', response: 'not-received' });
  });
  page.on('response', /** 关联响应与原始请求，记录真实状态及耗时。
 * @param response - 当前收到的接口响应。 */ response => {
    const entry = requests.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    recorder.record('http.response', { ...entry, status: response.status(), response: 'received', elapsedMs: Date.now() - entry.start,
      source: response.fromServiceWorker() ? 'service-worker' : 'browser' });
    // 仅读取节点列表响应；从不收集登录、钱包或游戏请求的正文。
    if (/^\/public\/v1[23]\/metadata\/servers$/.test(entry.path)) {
      const reading = response.json().then(/** 从元数据响应中提取候选节点并记录脱敏节点发现信息。
 * @param body - 当前操作使用的 body。 */ body => {
        const servers = body?.result?.servers;
        if (!servers || typeof servers !== 'object') return;
        const names = Array.isArray(servers) ? servers : Object.keys(servers);
        recorder.record('nodes.received', { ...entry, candidates: names.filter(/** 仅保留满足以下条件的条目：`typeof name === 'string'`。
 * @param name - 当前操作使用的 name。 */ name => typeof name === 'string').map(diagnosticNode) });
      }).catch(/** 元数据正文不可读时记录明确事件，保留请求定位信息。 */ () => recorder.record('nodes.unreadable', entry));
      pendingMetadata.add(reading);
      void reading.finally(/** 元数据处理结束后从待处理集合移除该任务。 */ () => pendingMetadata.delete(reading));
    }
  });
  page.on('requestfinished', /** 请求正常结束时记录最终状态、响应接收情况与总耗时。
 * @param request - 当前发出的接口请求。 */ request => {
    const entry = requests.get(request);
    if (entry) recorder.record('http.finished', { ...entry, status: entry.status ?? 'unavailable',
      response: entry.status === undefined ? 'not-received' : 'received', elapsedMs: Date.now() - entry.start });
    requests.delete(request);
  });
  page.on('requestfailed', /** 请求失败时关联原始请求，记录安全原因、实际状态和耗时。
 * @param request - 当前发出的接口请求。 */ request => {
    const entry = requests.get(request);
    if (entry) recorder.record('http.failed', { ...entry, status: entry.status ?? 'unavailable',
      response: entry.status === undefined ? 'not-received' : 'received', elapsedMs: Date.now() - entry.start,
      reason: request.failure()?.errorText || 'unknown' });
    requests.delete(request);
  });
  page.on('websocket', /** 为 WebSocket 分配连接标识并监听错误与关闭事件。
 * @param socket - 当前网络连接。 */ socket => {
    const url = new URL(socket.url());
    const connection = { connectionId: `socket-${++sequence}`, node: diagnosticNode(url.origin), path: url.pathname };
    recorder.record('websocket.start', connection);
    socket.on('socketerror', /** 记录当前 WebSocket 的失败原因和安全连接定位信息。
 * @param reason - 当前操作使用的 reason。 */ reason => recorder.record('websocket.error', { ...connection, reason }));
    socket.on('close', /** 记录当前 WebSocket 连接关闭事件。 */ () => recorder.record('websocket.closed', connection));
    // 不保存原始消息：认证与业务正文可能包含凭据；订阅及 RPC 概要由应用/代理提供。
  });
  page.on('pageerror', /** 将页面错误原因脱敏后加入诊断时间线。
 * @param error - 当前操作抛出的错误。 */ error => recorder.record('page.error', { reason: safeDiagnosticReason(error.message) }));
  page.on('crash', /** 记录浏览器页面崩溃事件。 */ () => recorder.record('page.crash'));
  return {
    recorder,
    /**
     * 在清理之前保存全部脱敏事件，并将短摘要附到 Playwright 报告。
     * @param failure - 触发保存的原始错误；正常完成时省略。
     */
    async save(failure?: unknown): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([...pendingMetadata]), new Promise<void>(/** 为未完成的元数据诊断设置最长两秒的收尾等待。
 * @param resolve - 完成当前异步等待的通知。 */ resolve => {
        timer = setTimeout(resolve, 2000);
      })]);
      clearTimeout(timer);
      recorder.record(failure ? 'test.failure' : 'test.complete',
        { reason: failure === undefined ? '' : safeDiagnosticReason(failure) });
      for (const entry of requests.values()) recorder.record('http.pending', { ...entry, status: entry.status ?? 'unavailable',
        response: entry.status === undefined ? 'not-received' : 'received', elapsedMs: Date.now() - entry.start });
      if (proxy.diagnostics) {
        try {
          const history = await proxy.diagnostics();
          recorder.merge(history.events, history.dropped);
        } catch (error) { recorder.record('proxy.diagnostics-unavailable', { reason: safeDiagnosticReason(error) }); }
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
