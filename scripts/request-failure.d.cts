/**
 * 构造不含私有资料、可直接传播的请求错误。
 * @param operation - 已审阅的逻辑操作。
 * @param reason - 已审阅的原因枚举。
 * @param status - 实际收到的 HTTP 状态，未收到则省略。
 */
export function requestFailure(operation: string, reason?: string, status?: number): Error;
/**
 * 将未知网络异常映射为固定枚举。
 * @param error - 未知底层异常。
 */
export function requestFailureReason(error: unknown): string;
/**
 * 日志边界只接受已审阅的安全模板。
 * @param value - 原始异常或消息。
 */
export function safeDiagnosticReason(value: unknown): string;
