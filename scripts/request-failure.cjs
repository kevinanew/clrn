/** 请求错误只输出已审阅的操作表、原因枚举与真实响应状态，不携带原始 cause。 */
const operations = {
  'prepare-account-login': ['准备账号登录', 'POST'],
  'prepare-account-set-coins': ['设置测试金币', 'POST'],
  'prepare-account-verify-coins': ['核对测试金币', 'PUT'],
  'prepare-room-house': ['核对测试私人房屋', 'PUT'],
  'prepare-room-list': ['读取测试私人房间列表', 'PUT'],
  'prepare-room-inspect': ['复查测试私人房间', 'GET'],
  'prepare-room-delete': ['清理测试私人房间', 'DELETE'],
  'prepare-room-verify': ['回读测试私人房间列表', 'PUT'],
  'renewal-price': ['续时数据准备', 'POST'],
  'renewal-wallet': ['续时数据准备', 'PUT'],
  'leaderboard-profile': ['个人排行榜数据准备', 'GET'],
  'leaderboard-statistics': ['个人排行榜数据准备', 'PUT'],
  'room-read-session': ['读取建房会话', 'LOCAL', 'browser-state'],
  'room-read-diamonds': ['读取测试钻石余额', 'PUT'],
  'room-top-up-diamonds': ['测试账号补钻', 'POST'],
  'room-create': ['创建私人房间', 'POST'],
  'room-delete': ['解散本次私人房间', 'DELETE'],
  'texas-enter': ['德州观察者连接', 'PUT'],
  'validate-account': ['账户接口校验', 'GET'],
  'existing-account-setup': ['准备已有只读账号页面', 'LOCAL', 'browser-ui'],
  'existing-account-origin': ['核对只读账号页面来源', 'LOCAL', 'browser-ui'],
  'existing-account-login-ui': ['准备已有只读账号登录表单', 'LOCAL', 'browser-ui'],
  'existing-account-login-await': ['等待已有只读账号登录响应（请求未观察到）', 'UNKNOWN', 'browser-ui'],
  'existing-account-session-check': ['准备只读账号会话校验', 'LOCAL', 'browser-state'],
  'existing-account-wallet-check': ['准备只读账号钱包读取', 'LOCAL', 'browser-state'],
  'functional-open-hall': ['打开功能测试大厅', 'GET', 'web-entry'],
  'existing-account-login': ['已有只读账号登录', 'POST'],
  'existing-account-session': ['核对已有只读账号会话', 'GET'],
  'existing-account-wallet': ['读取已有只读账号钱包', 'PUT'],
  'release-readiness': ['检查 Release 静态服务', 'GET', 'release-static'],
  'release-static-read': ['读取 Release 静态资源', 'GET', 'release-static'],
  'unknown-request': ['接口请求', 'UNKNOWN', 'unknown'],
};
const trustedFailures = new WeakMap();
const trustedMessages = new Set();
const reasons = new Set(['http-error', 'timeout', 'connection-failed', 'aborted', 'request-failed',
  'invalid-json', 'body-read-failed', 'business-rejected', 'invalid-response']);
// Playwright 会移除顶层 code；只识别异常首部的固定枚举，不能扫描 URL 或 Call log。
const playwrightConnectionFailure = /^apiRequestContext\.(?:get|head|post|put|patch|delete|fetch): (?:(?:connect|read|write|getaddrinfo) )?(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET)(?=[ \t\r\n]|$)/;
// 锁定版本在有限重试耗尽时增加此固定包装；只接纳确切的断连首行。
const playwrightSocketClosed = /^apiRequestContext\.(?:get|head|post|put|patch|delete|fetch): (?:Failed after [1-9][0-9]* attempt\(s\): Error: )?socket hang up(?:\r?\n|$)/;

/**
 * 仅将底层异常映射到固定原因，不序列化消息、堆栈、URL、请求头或嵌套异常。
 * @param error - 网络边界捕获的未知异常。
 */
function requestFailureReason(error) {
  const visited = new Set();
  for (let depth = 0; error && typeof error === 'object' && depth < 8 && !visited.has(error); depth++) {
    visited.add(error);
    try {
      if (error.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error.code)
        || typeof error.message === 'string' && /^apiRequestContext\.(?:get|put|post|delete|fetch): Timeout \d+ms exceeded/.test(error.message)) return 'timeout';
      if (error.name === 'AbortError') return 'aborted';
      if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(error.code)
        || typeof error.message === 'string' && (playwrightConnectionFailure.test(error.message)
          || playwrightSocketClosed.test(error.message))) return 'connection-failed';
      error = error.cause;
    } catch { break; }
  }
  return 'request-failed';
}

/**
 * 构造可直接传播、打印和持久化的安全错误；状态只接受调用方实际收到的 HTTP 响应。
 * @param operation - 代码中固定的逻辑操作标识。
 * @param reason - 已审阅的错误类别。
 * @param status - 已收到的 HTTP 状态；未收到响应时省略。
 */
function requestFailure(operation, reason = 'request-failed', status) {
  if (!Object.hasOwn(operations, operation)) operation = 'unknown-request';
  if (!reasons.has(reason)) reason = 'request-failed';
  const [stage, method, source = 'laiwan_prd'] = operations[operation];
  const received = method !== 'LOCAL' && method !== 'UNKNOWN'
    && Number.isInteger(status) && status >= 100 && status <= 599;
  const error = new Error(`${stage}失败：method=${method} operation=${operation} source=${source} status=${received ? status : 'unavailable'} response=${received ? 'received' : 'not-received'} reason=${reason}`);
  trustedFailures.set(error, error.message);
  trustedMessages.add(error.message);
  return error;
}

/**
 * 只接受本进程在请求边界构造过的完整模板，不从后端自由文本推断状态。
 * @param value - 候选消息。
 */
function reviewedRequestMessage(value) {
  return typeof value === 'string' && trustedMessages.has(value) ? value : undefined;
}

/**
 * 只保留完全符合固定模板的安全请求错误；其他自由文本只返回有限的错误分类。
 * @param value - 日志边界收到的原始异常或消息。
 */
function safeDiagnosticReason(value) {
  // 上层包装可含不可信文本；只从本模块创建的错误中恢复已审阅的定位，不打印包装层。
  let current = value;
  const visited = new Set();
  for (let depth = 0; current && typeof current === 'object' && depth < 8 && !visited.has(current); depth++) {
    if (trustedFailures.has(current)) return trustedFailures.get(current);
    visited.add(current);
    try {
      const safe = reviewedRequestMessage(current.message);
      if (safe) return safe;
      current = current.cause;
    } catch { break; }
  }
  if (typeof value === 'string') {
    const safe = reviewedRequestMessage(value);
    if (safe) return safe;
    if (/^detail=withheld reason=(?:request-failed|timeout|connection-failed|aborted)$/.test(value)) return value;
    if (['timeout', 'connection-failed', 'detail-withheld'].includes(value)) return value;
    if (/^(?:net::ERR_(?:ABORTED|CONNECTION_(?:CLOSED|RESET|REFUSED)|TIMED_OUT|NAME_NOT_RESOLVED)|unknown)$/.test(value)) return value;
  }
  return `detail=withheld reason=${requestFailureReason(value)}`;
}

module.exports = { requestFailure, requestFailureReason, safeDiagnosticReason };
