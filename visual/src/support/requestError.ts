import { requestFailure, requestFailureReason } from '../../../scripts/request-failure.cjs';

/**
 * 丢弃原始异常全部文本与 cause，只保留固定操作和原因枚举；没有响应时不猜测状态。
 * @param error - 请求边界捕获的未知异常。
 * @param operation - 调用点固定的非敏感操作标识。
 */
export function requestErrorSummary(error: unknown, operation = 'unknown-request'): string {
  return requestFailure(operation, requestFailureReason(error)).message;
}

export { requestFailure };
