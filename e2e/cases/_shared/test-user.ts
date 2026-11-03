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
  if (body.result?.username !== credentials.username
    || typeof body.result?.user_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.result.user_id)) {
    throw requestFailure('create-test-account', 'invalid-response', status);
  }
  return { userId: body.result.user_id, username: body.result.username };
}

export { stagingUserOrigin };
