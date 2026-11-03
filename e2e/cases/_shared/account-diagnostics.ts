import type { Page } from '@playwright/test';
import { accountStatus, type Session } from './auth';
import { requestFailure, requestFailureReason, safeDiagnosticReason } from '../../../scripts/request-failure.cjs';

/**
 * URL解析失败不传播原生异常的input字段；此时尚未发出请求。
 * @param value - 缓存或会话中的账号地址，仅在进程内校验。
 */
export function parseAccountUrl(value: string): URL {
  try { return new URL(value); }
  catch { throw requestFailure('creation-account-state', 'invalid-response'); }
}

/**
 * 账号 fixture 只传播已审阅的请求定位；未知错误保留固定的本地准备阶段。
 * @param error - 账号准备边界捕获的错误，可能包含私有文本。
 * @param operation - 调用方固定的本地准备操作。
 */
export function accountPreparationError(error: unknown, operation: string): Error {
  const diagnostic = safeDiagnosticReason(error);
  if (diagnostic.includes(' operation=')) return new Error(diagnostic);
  return requestFailure(operation, requestFailureReason(error));
}

/**
 * 保留既有会话必须返回200的要求，其他真实状态必须通过安全模板传播。
 * @param page - 当前账号所在的页面。
 * @param account - 已登录或从本轮缓存恢复的账号。
 */
export async function verifyAccountSession(page: Page, account: Session): Promise<void> {
  const status = await accountStatus(page, account);
  if (status !== 200) throw requestFailure('existing-account-session',
    status < 200 || status >= 300 ? 'http-error' : 'invalid-response', status);
}
