/** 在读取响应的边界丢弃不可信诊断；实际 HTTP 状态在读取正文之前取得。 */
import type { APIResponse } from '@playwright/test';
import { requestFailure, requestErrorSummary } from './requestError';
import { createHash } from 'node:crypto';
import { attachRoomRejection } from './roomRejectionDiagnostics';

type JsonResponse = Pick<APIResponse, 'ok' | 'status' | 'json'> & Partial<Pick<APIResponse, 'text'>>;

/**
 * 仅允许本轮失败接口进入有限响应诊断。
 * @param operation - 代码固定的逻辑操作。
 */
function needsRejectionDiagnostic(operation: string): operation is 'room-delete' | 'room-create' | 'leaderboard-statistics' {
  return ['room-delete', 'room-create', 'leaderboard-statistics'].includes(operation);
}

/**
 * 读取失败响应的有限诊断信息。
 * @param response - 已收到的真实响应。
 * @param operation - 需要诊断的操作。
 */
async function diagnoseRejection(response: JsonResponse, operation: 'room-delete' | 'room-create' | 'leaderboard-statistics') {
  let body;
  let bodyRead: 'json' | 'invalid-json' | 'body-read-failed' = 'json';
  let wireBody;
  try {
    if (response.text) {
      const text = await response.text();
      // 不保留正文；仅关联重复的非 JSON 错误页，区分空响应、HTML 与其他内容。
      wireBody = { bytes: Buffer.byteLength(text), fingerprint: createHash('sha256').update(text).digest('hex'),
        format: !text.trim() ? 'empty' : /^\s*<(?:!doctype\s+html|html)\b/i.test(text) ? 'html' : 'other' };
      body = JSON.parse(text);
    } else body = await response.json();
  } catch (error) {
    bodyRead = error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed';
  }
  await attachRoomRejection(body, operation, bodyRead, wireBody);
}

/**
 * 读取 HTTP 和业务均成功的 JSON，保留错误阶段与实际响应状态。
 * @param response - 已收到的真实响应。
 * @param operation - 代码固定的逻辑操作。
 */
export async function readRequestJson(response: JsonResponse, operation: string) {
  const status = response.status();
  if (!response.ok()) {
    if (needsRejectionDiagnostic(operation)) await diagnoseRejection(response, operation);
    throw requestFailure(operation, 'http-error', status);
  }
  let body;
  try { body = await response.json(); }
  catch (error) {
    throw requestFailure(operation, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed', status);
  }
  if (body?.ok !== true) {
    if (operation === 'room-create') await attachRoomRejection(body, operation);
    throw requestFailure(operation, 'business-rejected', status);
  }
  return body;
}

/**
 * 包装 Node fetch 的网络与响应解析出口，不携带底层错误或后端正文。
 * @param url - 仅用于实际请求的连接地址。
 * @param options - 原有请求配置、认证头和超时。
 * @param operation - 代码固定的逻辑操作。
 */
export async function fetchRequestJson(url: string, options: RequestInit, operation: string) {
  const response = await fetch(url, options).catch(/** 将 fetch 底层异常转换为不含敏感资料的请求摘要。
 * @param error - 当前操作抛出的错误。 */ error => {
    throw new Error(requestErrorSummary(error, operation));
  });
  const body = await readRequestJson({ status: /** 读取真实状态。 */ () => response.status, ok: /** 读取真实 HTTP 结果。 */ () => response.ok,
    text: /** 读取失败响应的原始正文，仅用于脱敏摘要。 */ () => response.text(),
    json: /** 读取真实响应正文。 */ () => response.json() }, operation);
  return { body, status: response.status };
}
