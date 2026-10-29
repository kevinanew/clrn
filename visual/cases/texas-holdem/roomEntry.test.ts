import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIResponse, Page } from '@playwright/test';
import { enterTexasRoom } from './room';

const room = { roomId: '11111111-2222-4333-8444-555555555555',
  apiOrigin: 'https://room-entry.invalid', authorization: 'Bearer test-only' };

/**
 * 记录真实连接的请求约定，用内存响应验证解析失败和资源释放，无需账号或网络。
 * @param response - 本次接口响应。
 */
function fixture(response: Response) {
  let disposed = 0;
  let requests = 0;
  const page = { request: {
    /**
     * 验证观察者连接仍使用当前房间和原有请求参数。
     * @param url - 当前房间的连接接口。
     * @param options - 认证、协议和超时配置。
     */
    async put(url: string, options: unknown) {
      requests++;
      assert.equal(url, `${room.apiOrigin}/v10/texas_holdem/room/${room.roomId}/enter`);
      assert.deepEqual(options, { headers: { Authorization: room.authorization },
        data: { client_support: ['time_based_rules'] }, timeout: 15_000 });
      return {
        /** 读取模拟接口的 JSON 正文。 */
        json: () => response.json(),
        /** 读取模拟接口的状态码。 */
        status: () => response.status,
        /** 保留原有 HTTP 成功检查。 */
        ok: () => response.ok,
        /** 读取模拟接口的响应头。 */
        headers: () => {
          const headers: Record<string, string> = {};
          response.headers.forEach((value, name) => { headers[name] = value; });
          return headers;
        },
        /** 记录响应释放次数。 */
        dispose: async () => { disposed++; },
      } as unknown as APIResponse;
    },
  } } as unknown as Pick<Page, 'request'>;
  return { page,
    /** 失败不应重试，且每次响应都必须释放。 */
    verify() {
      assert.equal(requests, 1, '不得用重试掩盖原始失败');
      assert.equal(disposed, 1, '成功或失败都必须释放响应');
    },
  };
}

test('观察者连接错误页报告状态和媒体类型，保留失败且不输出正文或凭据', async () => {
  for (const [status, contentType, expectedType] of [
    [502, 'text/html; charset=utf-8', 'text/html'],
    [200, 'application/json', 'application/json'],
    [503, 'private-response-value', '其他或未知'],
  ] as const) {
    const { page, verify } = fixture(new Response('<html>private-response-body</html>',
      { status, headers: { 'content-type': contentType, 'x-private-header': 'private-header-value' } }));
    await assert.rejects(enterTexasRoom(page, room), {
      message: `德州观察者连接返回非 JSON：HTTP ${status}，响应类型=${expectedType}`,
    });
    verify();
  }
});

test('观察者连接继续要求 HTTP 和业务结果同时成功，并释放每种结果的响应', async () => {
  for (const [status, ok] of [[200, true], [200, false], [503, true]] as const) {
    const { page, verify } = fixture(Response.json({ ok }, { status }));
    if (status === 200 && ok) await enterTexasRoom(page, room);
    else await assert.rejects(enterTexasRoom(page, room), /大厅显示夹具使用当前私人房的真实观察者连接/);
    verify();
  }
});
