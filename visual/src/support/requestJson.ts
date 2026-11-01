/** 在读取响应的边界丢弃不可信诊断；实际 HTTP 状态在读取正文之前取得。 */
import type { APIResponse } from '@playwright/test';
import { requestFailure, requestErrorSummary } from './requestError';

type JsonResponse = Pick<APIResponse, 'ok' | 'status' | 'json'>;

/**
 * 读取 HTTP 和业务均成功的 JSON，保留错误阶段与实际响应状态。
 * @param response - 已收到的真实响应。
 * @param operation - 代码固定的逻辑操作。
 */
export async function readRequestJson(response: JsonResponse, operation: string) {
  const status = response.status();
  if (!response.ok()) throw requestFailure(operation, 'http-error', status);
  let body;
  try { body = await response.json(); }
  catch (error) {
    throw requestFailure(operation, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed', status);
  }
  if (body?.ok !== true) throw requestFailure(operation, 'business-rejected', status);
  return body;
}

/**
 * 包装 Node fetch 的网络与响应解析出口，不携带底层错误或后端正文。
 * @param url - 仅用于实际请求的连接地址。
 * @param options - 原有请求配置、认证头和超时。
 * @param operation - 代码固定的逻辑操作。
 */
export async function fetchRequestJson(url: string, options: RequestInit, operation: string) {
  const response = await fetch(url, options).catch(error => {
    throw new Error(requestErrorSummary(error, operation));
  });
  const body = await readRequestJson({ status: /** 读取真实状态。 */ () => response.status, ok: /** 读取真实 HTTP 结果。 */ () => response.ok,
    json: /** 读取真实响应正文。 */ () => response.json() }, operation);
  return { body, status: response.status };
}
