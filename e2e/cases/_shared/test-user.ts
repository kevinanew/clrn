import { requestFailure } from '../../../scripts/request-failure.cjs';
import { fetchRequestJson } from '../../../visual/src/support/requestJson';

const stagingUserOrigin = 'https://api.shafayouxi.org';

/**
 * 仅在 Node 进程中调用测试注册接口，避免把专用 token 写进浏览器 trace。
 * @param credentials - 登录凭据，包含 username 用户名和 password 密码。
 * @param token - 仅用于测试接口或代理控制接口的认证凭据。
 */
export async function createTestingAccount(
  credentials: { username: string; password: string },
  token: string,
): Promise<{ userId: string; username: string }> {
  if (!token.trim()) throw new Error('缺少 TESTING_API_TOKEN');
  const { body, status } = await fetchRequestJson(`${stagingUserOrigin}/public/v10/user/register/username_password/testing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Testing-Api-Token': token },
    body: JSON.stringify(credentials),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }, 'create-test-account');
  validateCreatedUser(body.result, credentials.username, status);
  return { userId: body.result.user_id, username: body.result.username };
}

export { stagingUserOrigin };

/**
 * 验证测试用户 ID 的原有 UUID 格式。
 * @param userId - 待验证的 ID。
 */
export function validTestingUserId(userId: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
}

/**
 * 校验注册响应的用户名、ID 类型与格式。
 * @param result - 注册业务结果。
 * @param username - 请求用户名。
 * @param status - 实际 HTTP 状态。
 */
function validateCreatedUser(result: any, username: string, status: number) {
  if (!createdUserIdentity(result, username)) throw requestFailure('create-test-account', 'invalid-response', status);
  if (!validTestingUserId(result.user_id)) throw requestFailure('create-test-account', 'invalid-response', status);
}

/**
 * 保持缺失注册结果的安全契约诊断。
 * @param result - 注册业务结果。
 * @param username - 请求用户名。
 */
function createdUserIdentity(result: any, username: string) {
  return [result?.username === username, typeof result?.user_id === 'string'].every(Boolean);
}
