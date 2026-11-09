// 仅由分配器的子进程测试通过 --import 加载，不提供生产跳过余额准备的开关。
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const userId = '11111111-2222-4333-8444-555555555555';
const loginPath = '/public/v10/user/login/username/password';
let username;

/** 验证准备期间未提前导出 CI 凭据，或仍持有本机账号锁。
 * @param directory - 测试的临时账号池目录。 */
function assertAccountHeld(directory) {
  if (process.env.GITHUB_ENV) {
    assert.equal(environmentContents(), '', '余额核对完成前不能导出测试账号');
    return;
  }
  assert.ok(existsSync(join(directory, 'locks', username.toLowerCase())), '余额准备必须持有该账号的锁');
}

/** 读取已存在的环境文件供导出时序断言。 */
function environmentContents() { return existsSync(process.env.GITHUB_ENV) ? readFileSync(process.env.GITHUB_ENV, 'utf8') : ''; }

/** 按测试指定的接口注入认证失败。
 * @param url - 当前请求。
 * @param directory - 当前夹具目录。 */
function rejectedRequest(url, directory) {
  const rejection = join(directory, 'reject-wallet');
  return existsSync(rejection) && url.includes(readFileSync(rejection, 'utf8'));
}

const replies = [
  [loginPath, /** 返回登录会话。 */ () => ({ user_id: userId, username,
    api_token: { token_type: 'Bearer', access_token: 'test-session' } })],
  ['/set_balance/testing', /** 核对固定余额写入正文。
   * @param body - 请求 JSON。 */ body => {
    assert.deepEqual(body, { currency_name: 'coin', balance: '10000' });
    return { wallet_id: userId, ...body };
  }],
  [`/v10/house/user/${userId}`, /** 返回当前账号房屋。 */ () => ({ house_id: userId, user_id: userId })],
  ['/v2/building/rooms', /** 记录准备完成并返回空列表。
   * @param body - 未使用的请求正文。
   * @param directory - 当前测试目录。 */ (body, directory) => {
    appendFileSync(join(directory, 'prepared-accounts'), `${username}\n`);
    return [];
  }],
];

/** 分发合成响应，未知路径必须精确为钱包回读。
 * @param url - 实际请求地址。
 * @param body - 实际请求正文。
 * @param directory - 夹具目录。 */
function fixtureReply(url, body, directory) {
  const entry = replies.find(/** 匹配固定业务后缀。
   * @param candidate - 后缀与响应构造器。 */ candidate => url.endsWith(candidate[0]));
  if (entry) return Response.json({ ok: true, result: entry[1](body, directory) });
  assert.equal(new URL(url).pathname, `/v10/wallet/${userId}`);
  return Response.json({ ok: true, result: { currencies: [{ code: 'coin', balance: '10000' }] } });
}

/** 解析可选请求正文。
 * @param options - 请求配置。 */
function requestBody(options) { return options.body === undefined ? undefined : JSON.parse(options.body); }

/** 核对请求边界、账号锁及凭据导出时序后返回隔离响应。
 * @param url - 固定 staging 请求地址。
 * @param options - 实际请求配置。 */
async function accountFetch(url, options) {
  const body = requestBody(options);
  const directory = dirname(process.env.GITHUB_ENV || process.env.CLRN_TEST_ACCOUNT_POOL);
  if (url.endsWith(loginPath)) username = body.username;
  assertAccountHeld(directory);
  assert.equal(new URL(url).origin, 'https://api.shafayouxi.org');
  assert.equal(options.redirect, 'error');
  return respondToRequest(url, body, directory);
}

/** 保持认证失败在业务响应之前生效。
 * @param url - 请求地址。
 * @param body - 请求正文。
 * @param directory - 当前测试目录。 */
function respondToRequest(url, body, directory) {
  if (rejectedRequest(url, directory)) return new Response('private-token', { status: 401 });
  return fixtureReply(url, body, directory);
}

globalThis.fetch = accountFetch;
