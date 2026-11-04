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
  test(scenario.name, /** 验证连接重置场景的有限重试、最终状态与认证信息脱敏。
 * @param t - 当前测试的生命周期与替换接口。 */ async (t) => {
    let attempts = 0;
    const authorization = 'bearer synthetic-private-test-token';
    const server = createServer(/** 按场景重置前几次连接，随后返回配置的会话状态。
 * @param incoming - 本机测试服务收到的请求。
 * @param outgoing - 本机测试服务发送的响应。 */ (incoming, outgoing) => {
      attempts++;
      assert.equal(incoming.headers.authorization, authorization);
      if (attempts <= scenario.resets) {
        incoming.socket.destroy();
      } else {
        outgoing.writeHead(scenario.status, { 'content-type': 'application/json' });
        outgoing.end('{}');
      }
    });
    await new Promise<void>(/** 等待本机会话测试服务开始监听。
 * @param resolve - 完成当前异步等待的通知。 */ (resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const api = await request.newContext();
    t.after(/** 释放 API 客户端并等待本机会话服务关闭。 */ async () => {
      await api.dispose();
      await new Promise<void>(/** 将服务关闭完成或失败转换为 Promise 结果。
 * @param resolve - 完成当前异步等待的通知。
 * @param reject - 传播当前异步失败的通知。 */ (resolve, reject) => {
        server.close(/** 根据关闭错误决定拒绝或完成服务清理。
 * @param error - 当前操作抛出的错误。 */ (error) => { if (error) reject(error); else resolve(); });
      });
    });
    const page = { request: api } as Page;
    const session = {
      userId: 'synthetic-account',
      accountUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/account`,
      authorization,
    };
    if (scenario.resets === 3) {
      await assert.rejects(accountStatus(page, session), /** 核对抛出错误的类型、原因与脱敏内容，确认失败符合预期。
 * @param error - 当前操作抛出的错误。 */ (error: Error) => {
        assert.equal(error.message, '核对已有只读账号会话失败：method=GET operation=existing-account-session source=laiwan_prd status=unavailable response=not-received reason=connection-failed');
        assert.equal(error.stack?.includes(authorization), false);
        return true;
      });
    } else {
      assert.equal(await accountStatus(page, session), scenario.status);
    }
    assert.equal(attempts, 3);
  });
}
