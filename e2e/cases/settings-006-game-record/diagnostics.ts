/** 观察战绩请求的 Chromium 底层状态；不修改请求、响应或测试等待。 */
import type { Page, TestInfo } from '@playwright/test';
import { diagnosticNode, diagnosticPath } from '../../helpers/diagnostic-privacy';
import { DiagnosticLog, diagnosticCaseDirectory } from '../../helpers/diagnostic-log';

const recordPaths = new Set([
  '/v1/texas_statistics/player/{user}/rounds/{rounds}',
  '/v11/game_log/{user}/play_session_record/recent',
]);

/**
 * CORS 拒绝时 Playwright 没有 response；只保存 CDP 提供的真实状态与固定分类。
 * @param page - 本例页面。
 * @param info - 本次设备和重试的独立身份。
 */
export async function collectGameRecordDiagnostics(page: Page, info: TestInfo): Promise<void> {
  const log = new DiagnosticLog(diagnosticCaseDirectory(info), 'game-record-network');
  try {
    const session = await page.context().newCDPSession(page);
    const requests = new Map<string, Record<string, string>>();
    session.on('Network.requestWillBeSent', /** 只关联登记的战绩接口，不保存头部或正文。
     * @param event - Chromium 的只读网络事件。
     */ event => {
      try {
        const url = new URL(event.request.url);
        const path = diagnosticPath(url.pathname);
        if (!recordPaths.has(path)) return;
        const fields = { requestId: event.requestId, node: diagnosticNode(url.origin),
          path, method: event.request.method };
        requests.set(event.requestId, fields);
        log.record('http.start', fields);
      } catch { /* 可选诊断不得改变请求或原始异常。 */ }
    });
    session.on('Network.responseReceivedExtraInfo', /** 保留 CORS 拒绝前的真实 HTTP 状态。
     * @param event - Chromium 的只读网络事件。
     */ event => {
      const fields = requests.get(event.requestId);
      if (fields) log.record('http.response', { ...fields, status: event.statusCode });
    });
    session.on('Network.loadingFailed', /** 只输出固定失败分类，不回显协议错误正文。
     * @param event - Chromium 的只读网络事件。
     */ event => {
      const fields = requests.get(event.requestId);
      if (fields) log.record('http.failed', { ...fields,
        reason: event.corsErrorStatus ? 'cors' : 'network', canceled: event.canceled === true });
      requests.delete(event.requestId);
    });
    session.on('Network.loadingFinished', /** 标记成功完成并释放关联。
     * @param event - Chromium 的只读网络事件。
     */ event => {
      const fields = requests.get(event.requestId);
      if (fields) log.record('http.finished', fields);
      requests.delete(event.requestId);
    });
    await session.send('Network.enable');
    page.once('close', /** 页面关闭时释放诊断会话。 */ () => {
      void session.detach().catch(/** 诊断清理失败不得影响测试。 */ () => undefined);
    });
  } catch { log.record('collection.unavailable'); }
}
