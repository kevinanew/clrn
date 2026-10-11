import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { request, type Page } from '@playwright/test';
import { accountStatus } from './auth';

for (const scenario of [
  { name: '连接重置两次后读取有效会话', resets: 2, status: 200 },
  { name: '连接重置两次后仍返回旧会话的 401', resets: 2, status: 401 },
  { name: '持续重置只尝试三次，失败信息不包含认证头', resets: 3, status: 200 },
]) {
  test(scenario.name, async (t) => {
    let attempts = 0;
    const authorization = 'bearer synthetic-private-test-token';
    const server = createServer((incoming, outgoing) => {
      attempts++;
      assert.equal(incoming.headers.authorization, authorization);
      if (attempts <= scenario.resets) {
        incoming.socket.destroy();
      } else {
        outgoing.writeHead(scenario.status, { 'content-type': 'application/json' });
        outgoing.end('{}');
      }
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const api = await request.newContext();
    t.after(async () => {
      await api.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve(); });
      });
    });
    const page = { request: api } as Page;
    const session = {
      userId: 'synthetic-account',
      accountUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/account`,
      authorization,
    };
    if (scenario.resets === 3) {
      await assert.rejects(accountStatus(page, session), (error: Error) => {
        assert.equal(error.message, '账号会话状态读取失败：网络请求未完成');
        assert.equal(error.stack?.includes(authorization), false);
        return true;
      });
    } else {
      assert.equal(await accountStatus(page, session), scenario.status);
    }
    assert.equal(attempts, 3);
  });
}
