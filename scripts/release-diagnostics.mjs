/** 静态服务本地生命周期，不输出入口、资源路径、文件系统路径或异常正文。 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 使用工作流原本上传的结果子目录，不修改执行定义或新增上传动作。
 * @param command - 原测试命令及参数。
 */
export function releaseDiagnosticDirectory(command) {
  if (command.some(/** 判断是否存在满足以下条件的条目：`part.startsWith('test:animations')`。
 * @param part - 当前操作使用的 part。 */ part => part.startsWith('test:animations'))) return 'test-results/animations/release-server';
  if (command.some(/** 判断是否存在满足以下条件的条目：`part.startsWith('test:functional')`。
 * @param part - 当前操作使用的 part。 */ part => part.startsWith('test:functional'))) return 'test-results/cases/release-server';
  if (command.includes('test:interactions')) return 'test-results/interactions/release-server';
  if (command.includes('test:freshchat')) return 'test-results/freshchat/release-server';
  return 'test-results/release-server';
}

/**
 * 保存有界 JSONL；文件位于既有报告目录，由原工作流上传。
 * @param directory - 当前任务报告目录。
 * @param persistentDirectory - 可选的独立目录，保留后续命令清理之前和退出时的日志。
 */
export function releaseDiagnosticWriter(directory, persistentDirectory) {
  mkdirSync(directory, { recursive: true });
  let count = 0;
  let dropped = 0;
  let droppedBytes = 0;
  let bytes = 0;
  const startedAt = Date.now();
  /**
   * 新增持久化副本失败只标记不可用，不改变原服务器或测试结果。
   * @param line - 已审阅事件行。
   * @param retained - 是否仍在容量范围内。
   */
  const persist = (line, retained) => {
    if (!persistentDirectory) return;
    try {
      mkdirSync(persistentDirectory, { recursive: true });
      if (retained) appendFileSync(path.join(persistentDirectory, 'release-server-events.jsonl'), line);
      writeFileSync(path.join(persistentDirectory, 'release-server-manifest.json'),
        JSON.stringify({ retention: 'first-events', limit: 10000, events: Math.min(count, 10000),
          startedAt, lastObservedAt: Date.now(), bytes, dropped, droppedBytes }));
    } catch {
      persistentDirectory = undefined;
      console.error('Release diagnostics: collection.unavailable (storage-write-failed)');
    }
  };
  /**
   * 只接收服务端构造的固定字段，不接收任意网络数据。
   * @param event - 内部生命周期事件。
   */
  const recordEvent = event => {
    count++;
    if (count > 10000) {
      dropped++;
      droppedBytes += Buffer.byteLength(JSON.stringify(event) + '\n');
    }
    if (count === 10001) event = { event: 'release.truncated', droppedAtLeast: 1, source: 'release-static' };
    // Playwright 启动时会清理 outputDir；每次写入都恢复既有附件子目录。
    const line = `${JSON.stringify(event)}\n`;
    if (count <= 10001) {
      mkdirSync(directory, { recursive: true });
      appendFileSync(path.join(directory, 'release-server-events.jsonl'), line);
      bytes += Buffer.byteLength(line);
    }
    persist(line, count <= 10001);
  };
  return recordEvent;
}

/**
 * 观察真实 TCP 套接字；不推断关闭方、HTTP 结果或后端实例。
 * @param socket - 本服务实际接受的连接。
 * @param identifiers - 本服务生成的关联编号。
 * @param record - 本轮持久化出口。
 */
export function observeReleaseConnection(socket, identifiers, record) {
  const start = Date.now();
  /**
   * 仅写固定阶段和结果；连接值与异常对象不进入出口。
   * @param event - 已审阅的连接事件。
   * @param outcome - 固定结果标记。
   */
  const emit = (event, outcome = 'observed') => record({ event, observedAt: Date.now(),
    source: 'release-static', operation: 'release-static-connect', ...identifiers,
    elapsedMs: Date.now() - start, outcome });
  emit('release.tcp-open');
  socket.once('end', /** 记录 TCP 对端结束事件，定位发布连接生命周期。 */ () => emit('release.tcp-end'));
  socket.on('timeout', /** 记录 TCP 超时事件，保留连接诊断时间线。 */ () => emit('release.tcp-timeout'));
  socket.on('error', /** 记录 TCP 错误事件，避免输出底层敏感资料。 */ () => emit('release.tcp-error'));
  socket.once('close', /** 按是否出错记录 TCP 连接关闭的原因。
 * @param hadError - 当前操作使用的 hadError。 */ hadError => emit('release.tcp-close', hadError ? 'error' : 'closed'));
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
  response.on('finish', /** 记录响应写入完成事件。 */ () => emit('release.finish'));
  response.on('close', /** 区分完整响应关闭与传输中断，记录对应诊断事件。 */ () => emit(response.writableFinished ? 'release.close' : 'release.interrupted'));
  response.on('error', /** 记录响应流错误，供发布链路排查。 */ () => emit('release.response-error'));
  return {
    emit,
    /**
     * 保留文件流成功和读取错误的区别，不输出文件名或底层 cause。
     * @param stream - 正在传输的实际文件流。
     */
    stream(stream) {
      emit('release.stream-open');
      stream.on('end', /** 记录发布资源文件源读取完毕事件。 */ () => emit('release.stream-end'));
      stream.on('error', /** 记录发布资源文件源读取失败事件。 */ () => emit('release.stream-error'));
      stream.on('close', /** 记录发布资源文件源关闭事件。 */ () => emit('release.stream-close'));
    },
  };
}
