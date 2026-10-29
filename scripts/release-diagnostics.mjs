/** 静态服务本地生命周期，不输出入口、资源路径、文件系统路径或异常正文。 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 使用工作流原本上传的结果子目录，不修改执行定义或新增上传动作。
 * @param command - 原测试命令及参数。
 */
export function releaseDiagnosticDirectory(command) {
  if (command.some(part => part.startsWith('test:animations'))) return 'test-results/animations/release-server';
  if (command.some(part => part.startsWith('test:functional'))) return 'test-results/cases/release-server';
  if (command.includes('test:interactions')) return 'test-results/interactions/release-server';
  if (command.includes('test:freshchat')) return 'test-results/freshchat/release-server';
  return 'test-results/release-server';
}

/**
 * 保存有界 JSONL；文件位于既有报告目录，由原工作流上传。
 * @param directory - 当前任务报告目录。
 */
export function releaseDiagnosticWriter(directory) {
  mkdirSync(directory, { recursive: true });
  let count = 0;
  /**
   * 只接收服务端构造的固定字段，不接收任意网络数据。
   * @param event - 内部生命周期事件。
   */
  const recordEvent = event => {
    if (count++ > 10000) return;
    if (count === 10001) event = { event: 'release.truncated', droppedAtLeast: 1, source: 'release-static' };
    // Playwright 启动时会清理 outputDir；每次写入都恢复既有附件子目录。
    mkdirSync(directory, { recursive: true });
    appendFileSync(path.join(directory, 'release-server-events.jsonl'), `${JSON.stringify(event)}\n`);
  };
  return recordEvent;
}

/**
 * 绑定一次响应与文件流事件，不改变传输、状态或错误退出。
 * @param request - 实际收到的请求。
 * @param response - 服务器响应。
 * @param identifiers - 服务生成的关联编号。
 * @param record - 本轮持久化出口。
 */
export function observeReleaseResponse(request, response, identifiers, record) {
  const start = Date.now();
  /**
   * 状态只在响应头实际发送后记录，不能把 Node 默认的 200 当成已收到响应。
   * @param event - 生命周期阶段。
   */
  const emit = event => record({ event, observedAt: Date.now(), source: 'release-static',
    operation: 'release-static-read', method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(request.method)
      ? request.method : 'OTHER', ...identifiers, elapsedMs: Date.now() - start,
    status: response.headersSent ? response.statusCode : 'unavailable',
    response: response.headersSent ? 'sent' : 'not-sent' });
  emit('release.request');
  response.on('finish', () => emit('release.finish'));
  response.on('close', () => emit(response.writableFinished ? 'release.close' : 'release.interrupted'));
  response.on('error', () => emit('release.response-error'));
  return {
    emit,
    /**
     * 保留文件流成功和读取错误的区别，不输出文件名或底层 cause。
     * @param stream - 正在传输的实际文件流。
     */
    stream(stream) {
      emit('release.stream-open');
      stream.on('end', () => emit('release.stream-end'));
      stream.on('error', () => emit('release.stream-error'));
      stream.on('close', () => emit('release.stream-close'));
    },
  };
}
