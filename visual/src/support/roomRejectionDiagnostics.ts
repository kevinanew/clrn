import { createHash } from 'node:crypto';

const categories = new Set(['server_error', 'invalid_parameter', 'permission_denied', 'insufficient_balance',
  'not_enough_diamond', 'invalid_token', 'room_limit_exceeded']);

/** 从服务端消息中区分建房拒绝的固定原因，不输出自由文本。
 * @param body - 已读取的拒绝正文。 */
function messageDiagnostic(body: any) {
  const message = typeof body?.message === 'string' ? body.message
    : typeof body?.error_message === 'string' ? body.error_message : '';
  const reasons = [
    ['timeout', /timeout|timed out|超时|逾時/i],
    ['balance', /insufficient|not.enough|余额不足|餘額不足|钻石不足|鑽石不足/i],
    ['room-limit', /room.limit|房间.*上限|房間.*上限/i],
    ['parameter', /invalid.parameter|参数|參數/i],
    ['permission', /permission|unauthorized|权限|權限/i],
    ['server', /internal.server|server.error|内部错误|內部錯誤/i],
  ] as const;
  return { messageCategory: reasons.find(/** 仅返回固定分类，不保留命中的消息。
   * @param root0 - 固定分类和匹配规则。 */ ([, pattern]) => pattern.test(message))?.[0] ?? 'unclassified',
    messageFingerprint: message ? createHash('sha256').update(message).digest('hex') : null };
}

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
    ...messageDiagnostic(body),
  };
}

/**
 * 为房间及排行榜 HTTP 或业务拒绝保留有限分类、数字错误码和类型指纹，不输出正文、参数或自由文本。
 * @param body - 已读取的失败响应；不再次发送请求。
 * @param operation - 固定的建房、删房或排行榜操作，用于区分附件。
 * @param bodyRead - 正文读取结果，仅记录固定分类。
 * @param wireBody - 原始正文的长度、指纹及固定格式分类，不包含正文。
 */
export async function attachRoomRejection(body: any, operation: 'room-delete' | 'room-create' | 'leaderboard-statistics',
  bodyRead: 'json' | 'invalid-json' | 'body-read-failed' = 'json',
  wireBody?: { bytes: number; fingerprint: string; format: string; errorPage?: string; server?: string }): Promise<void> {
  try {
    const diagnostic = { ...roomDiagnostic(body), bodyRead, wireBody };
    try {
      // 共享请求辅助代码也由仅安装 e2e 依赖的任务加载；仅在失败诊断时加载 visual 的测试运行器。
      const { test } = await import('@playwright/test');
      await test.info().attach(`${operation}-rejection`, { body: JSON.stringify(diagnostic), contentType: 'application/json' });
    } catch {
      // 附件上下文不可用时仍保留有限分类；不输出异常或响应正文。
      console.warn(`${operation}-rejection ${JSON.stringify(diagnostic)}`);
    }
  } catch { /* 诊断失败不能覆盖原始拒绝。 */ }
}
