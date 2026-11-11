import { createHash } from 'node:crypto';

const categories = new Set(['server_error', 'invalid_parameter', 'permission_denied', 'insufficient_balance',
  'not_enough_diamond', 'invalid_token', 'room_limit_exceeded']);

/** 提取可安全写入报告的有限诊断。
 * @param body - 已读取的失败响应。 */
function roomDiagnostic(body: any) {
  const errorType = typeof body?.error_type === 'string' ? body.error_type : '';
  return {
    category: categories.has(errorType) ? errorType : 'unclassified',
    typeFingerprint: errorType ? createHash('sha256').update(errorType).digest('hex') : null,
    code: Number.isSafeInteger(body?.code) ? body.code : null,
    hasErrorType: Boolean(errorType),
    hasErrors: body?.errors != null,
    hasResult: body?.result != null,
  };
}

/**
 * 为房间 HTTP 或业务拒绝保留有限分类、数字错误码和类型指纹，不输出正文、参数或自由文本。
 * @param body - 已读取的失败响应；不再次发送请求。
 * @param operation - 固定的建房或删房操作，用于区分附件。
 */
export async function attachRoomRejection(body: any, operation: 'room-delete' | 'room-create'): Promise<void> {
  try {
    // 共享请求辅助代码也由仅安装 e2e 依赖的任务加载；仅在房间诊断时加载 visual 的测试运行器。
    const diagnostic = roomDiagnostic(body);
    // 日志保留同一份有限分类，即使运行器附件不可用也不丢失拒绝证据。
    console.warn(`${operation}-rejection ${JSON.stringify(diagnostic)}`);
    const { test } = await import('@playwright/test');
    await test.info().attach(`${operation}-rejection`, { body: JSON.stringify(diagnostic), contentType: 'application/json' });
  } catch { /* 附件失败不能覆盖房间拒绝。 */ }
}
