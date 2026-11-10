/** 在读取响应的边界丢弃不可信诊断；实际 HTTP 状态在读取正文之前取得。 */
import type { APIResponse } from '@playwright/test';
import { requestFailure, requestErrorSummary } from './requestError';
import { attachRoomRejection } from './roomRejectionDiagnostics';

type JsonResponse = Pick<APIResponse, 'ok' | 'status' | 'json'>;

/**
 * 读取 HTTP 和业务均成功的 JSON，保留错误阶段与实际响应状态。
 * @param response - 已收到的真实响应。
 * @param operation - 代码固定的逻辑操作。
 */
export async function readRequestJson(response: JsonResponse, operation: string) {
  const status = response.status();
  if (!response.ok()) {
    await attachRoomHttpRejection(response, operation);
    throw requestFailure(operation, 'http-error', status);
  }
  const body = await parseResponseJson(response, operation, status);
  assertBusinessSuccess(body, operation, status);
  return body;
}

/** 仅为删房 HTTP 失败补充脱敏分类，不改变原始错误。
 * @param response - 已收到的失败响应。
 * @param operation - 代码固定的逻辑操作。 */
async function attachRoomHttpRejection(response: JsonResponse, operation: string): Promise<void> {
  if (operation !== 'room-delete') return;
  try { await attachRoomRejection(await response.json(), operation); }
  catch { /* 非 JSON 或正文读取失败不能覆盖原始 HTTP 错误。 */ }
}

/** 在读取正文的边界保留实际响应状态并丢弃不可信错误。
 * @param response - 真实响应。
 * @param operation - 固定操作名。
 * @param status - 已读取的 HTTP 状态。 */
async function parseResponseJson(response: JsonResponse, operation: string, status: number) {
  try { return await response.json(); }
  catch (error) {
    throw requestFailure(operation, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed', status);
  }
}

/** 业务失败不能被 HTTP 成功掩盖。
 * @param body - 响应 JSON。
 * @param operation - 固定操作名。
 * @param status - 实际 HTTP 状态。 */
function assertBusinessSuccess(body: any, operation: string, status: number): void {
  if (body?.ok !== true) throw requestFailure(operation, 'business-rejected', status);
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
    json: /** 读取真实响应正文。 */ () => response.json() }, operation);
  return { body, status: response.status };
}
