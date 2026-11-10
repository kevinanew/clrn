import { createHash } from 'node:crypto';

const categories = new Set(['server_error', 'invalid_parameter', 'permission_denied', 'insufficient_balance',
  'not_enough_diamond', 'invalid_token', 'room_limit_exceeded']);

/**
 * 为建房 HTTP 或业务拒绝保留有限分类、数字错误码和类型指纹，不输出正文、参数或自由文本。
 * @param body - 已读取的失败响应；不再次发送请求。
 */
export async function attachRoomRejection(body: any): Promise<void> {
  try {
    // 共享请求辅助代码也由仅安装 e2e 依赖的任务加载；仅在建房诊断时加载 visual 的测试运行器。
    const { test } = await import('@playwright/test');
    const errorType = typeof body?.error_type === 'string' ? body.error_type : '';
    const diagnostic = {
      category: categories.has(errorType) ? errorType : 'unclassified',
      typeFingerprint: errorType ? createHash('sha256').update(errorType).digest('hex') : null,
      code: Number.isSafeInteger(body?.code) ? body.code : null,
      hasErrorType: Boolean(errorType),
      hasErrors: body?.errors != null,
      hasResult: body?.result != null,
    };
    await test.info().attach('room-create-rejection', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
  } catch { /* 附件失败不能覆盖建房业务拒绝。 */ }
}
