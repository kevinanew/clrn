/** 只为准确接口注入 5xx；登录透传，截图从登录完成后开始。 */
import path from 'node:path';
import { test as accountTest, expect } from '../../cases/_shared/creation-account-fixture';
import { withMitmproxy } from '../../helpers/mitmproxy-session';
import type { Mitmproxy } from '../../helpers/mitmproxy-client';

export const test = accountTest.extend<{ serverErrors: Mitmproxy }>({
  /**
   * 每例管理独立代理、证书和仅支持 5xx 的插件。
   * @param fixtures - 本夹具不依赖其他夹具。
   * @param use - 执行真实页面测试。
   */
  serverErrors: async ({}, use) => {
    await withMitmproxy(use, { addonPath: path.resolve(__dirname, '../../mitmproxy/server_errors.py') });
  },
  /**
   * 正常初始化和登录同样透传本轮代理，不替换客户端状态。
   * @param fixtures - 本轮专用代理。
   * @param use - 使用代理创建浏览器上下文。
   */
  proxy: async ({ serverErrors }, use) => {
    await use({ server: serverErrors.server, bypass: '<-loopback>' });
  },
  ignoreHTTPSErrors: true,
});

export { expect };
