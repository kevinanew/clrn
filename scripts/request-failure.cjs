/** 请求错误只输出已审阅的操作表、原因枚举与真实响应状态，不携带原始 cause。 */
const operations = {
  'create-test-account': ['创建测试账号', 'POST'],
  'set-creation-diamonds': ['设置创建账号钻石', 'POST'],
  'creation-account-setup': ['准备创建账号页面', 'LOCAL', 'browser-ui'],
  'creation-account-state': ['读取创建账号状态', 'LOCAL', 'browser-state'],
  'creation-account-session-check': ['准备创建账号会话校验', 'LOCAL', 'browser-state'],
  'creation-account-notices': ['处理创建账号登录提示', 'LOCAL', 'browser-ui'],
  'second-account-setup': ['准备多用户测试账号', 'LOCAL', 'browser-ui'],
  'register-account-setup': ['准备测试注册账号', 'LOCAL', 'browser-ui'],
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
  'player-profile': ['玩家资料准备', 'GET'],
  'player-wallet': ['玩家资料准备', 'GET'],
  'player-statistics': ['玩家资料准备', 'GET'],
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
  return findCauseValue(error, classifyRequestError) || 'request-failed';
}

/** 只沿有限、未访问过的对象异常链查找。
 * @param value - 当前异常。
 * @param visited - 已访问对象。
 * @param depth - 当前深度。 */
function traversableCause(value, visited, depth) {
  if (!value) return false;
  return [typeof value === 'object', depth < 8, !visited.has(value)].every(Boolean);
}

/** 将未知 getter 异常限制在当前节点，不能越过异常继续读取 cause。
 * @param current - 当前异常节点。
 * @param select - 安全值分类器。 */
function inspectCause(current, select) {
  try {
    const value = select(current);
    if (value) return { stop: true, value };
    return { stop: false, cause: current.cause };
  } catch { return { stop: true }; }
}

/** 按原有深度和循环边界查找，分类成功后不读取 cause。
 * @param current - 顶层异常。
 * @param select - 当前节点的分类器。 */
function findCauseValue(current, select) {
  const visited = new Set();
  for (let depth = 0; traversableCause(current, visited, depth); depth++) {
    visited.add(current);
    const inspected = inspectCause(current, select);
    if (inspected.stop) return inspected.value;
    current = inspected.cause;
  }
}

/** 只匹配字符串消息，不能将其他值强制序列化。
 * @param error - 当前异常。
 * @param patterns - 已审阅的首行表达式。 */
function matchesMessage(error, patterns) {
  return typeof error.message === 'string' && patterns.some(/** 核对固定消息模式。
   * @param pattern - 已审阅表达式。 */ pattern => pattern.test(error.message));
}

/** 保留 timeout、aborted、connection-failed 的原有优先级。
 * @param error - 当前异常节点。 */
function classifyRequestError(error) {
  if (timeoutError(error)) return 'timeout';
  if (error.name === 'AbortError') return 'aborted';
  return connectionReason(error);
}

/** 核对错误名、错误码与 Playwright 固定超时首行。
 * @param error - 当前异常节点。 */
function timeoutError(error) {
  if (error.name === 'TimeoutError') return true;
  return ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error.code)
    || matchesMessage(error, [/^apiRequestContext\.(?:get|put|post|delete|fetch): Timeout \d+ms exceeded/]);
}

/** 仅登记的连接错误码和首行可判断断连。
 * @param error - 当前异常节点。 */
function connectionReason(error) {
  const known = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(error.code)
    || matchesMessage(error, [playwrightConnectionFailure, playwrightSocketClosed]);
  return known ? 'connection-failed' : undefined;
}

/**
 * 构造可直接传播、打印和持久化的安全错误；状态只接受调用方实际收到的 HTTP 响应。
 * @param operation - 代码中固定的逻辑操作标识。
 * @param reason - 已审阅的错误类别。
 * @param status - 已收到的 HTTP 状态；未收到响应时省略。
 */
function requestFailure(operation, reason = 'request-failed', status) {
  if (!Object.hasOwn(operations, operation)) operation = 'unknown-request';
  reason = knownReason(reason);
  return createFailure(operations[operation], operation, reason, status);
}

/** 只接受真实 HTTP 方法的有效状态范围。
 * @param method - 已审阅方法。
 * @param status - 实际响应状态。 */
function receivedStatus(method, status) {
  if (!Number.isInteger(status)) return false;
  return [method !== 'LOCAL', method !== 'UNKNOWN', status >= 100, status <= 599].every(Boolean);
}

/** 构造固定错误模板并登记可信身份。
 * @param descriptor - 操作的展示信息。
 * @param operation - 固定操作标识。
 * @param reason - 已核对原因。
 * @param status - 实际响应状态。 */
function createFailure(descriptor, operation, reason, status) {
  const [stage, method, source = 'laiwan_proxy'] = descriptor;
  const received = receivedStatus(method, status);
  const error = new Error(`${stage}失败：method=${method} operation=${operation} source=${source} status=${received ? status : 'unavailable'} response=${responseState(received)} reason=${reason}`);
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
  const trusted = findCauseValue(value, trustedCauseMessage);
  return trusted || safeTextReason(value);
}

/** 从原生可信错误或已登记的完整消息恢复定位。
 * @param current - 当前异常节点。 */
function trustedCauseMessage(current) {
  if (trustedFailures.has(current)) return trustedFailures.get(current);
  return reviewedRequestMessage(current.message);
}

/** 已登记模板与有限分类文本可以原样输出。
 * @param value - 候选异常或消息。 */
function safeTextReason(value) {
  if (typeof value === 'string') {
    const safe = reviewedRequestMessage(value);
    if (safe) return safe;
    return allowedTextReason(value);
  }
  return `detail=withheld reason=${requestFailureReason(value)}`;
}

/** 自由文本仅接受原有的固定枚举与浏览器错误码。
 * @param value - 原始字符串。 */
function allowedTextReason(value) {
  const allowed = [/^detail=withheld reason=(?:request-failed|timeout|connection-failed|aborted)$/,
    /^(?:net::ERR_(?:ABORTED|CONNECTION_(?:CLOSED|RESET|REFUSED)|TIMED_OUT|NAME_NOT_RESOLVED)|unknown)$/];
  if (allowedDiagnosticText(value, allowed)) return value;
  return `detail=withheld reason=${requestFailureReason(value)}`;
}

/** 允许列表必须精确匹配，不能接受固定枚举后的额外换行。
 * @param value - 原始字符串。
 * @param allowed - 已审阅的诊断表达式。 */
function allowedDiagnosticText(value, allowed) {
  return ['timeout', 'connection-failed', 'detail-withheld'].includes(value) || allowed.some(/** 核对允许原样输出的文本。
   * @param pattern - 固定表达式。 */ pattern => pattern.test(value));
}

/** 将是否收到响应转为固定字段。
 * @param received - 是否实际收到 HTTP 响应。 */
function responseState(received) { return received ? 'received' : 'not-received'; }

module.exports = { requestFailure, requestFailureReason, safeDiagnosticReason };

/** 只接受登记的错误类别。
 * @param reason - 候选错误类别。 */
function knownReason(reason) { return reasons.has(reason) ? reason : 'request-failed'; }
