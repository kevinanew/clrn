/** 统一校验测试入口，仅允许指定 Staging 站点或本轮 Release 包的回环服务器。 */

/**
 * 解析测试入口；Release 模式强制所有套件访问同一服务器，防止配置意外回退线上。
 * @param address - 普通测试配置的地址。
 * @param environment - 本轮服务器传递的环境变量。
 */
export function readTestWebUrl(address: string | undefined, environment: NodeJS.ProcessEnv): string {
  const releaseAddress = environment.CLRN_RELEASE_WEB_URL;
  if (environment.CLRN_RELEASE_WEB_ROOT && !releaseAddress) {
    throw new Error('Release 测试必须通过 with-release-web-server.mjs 启动');
  }
  const url = new URL(releaseAddress || address || 'https://h5.page.shafayouxi.org/');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('测试入口只能包含协议、主机和端口');
  }
  if (releaseAddress) {
    if (!environment.CLRN_RELEASE_WEB_ROOT || !/^[a-f0-9]{40}$/.test(environment.CLRN_EXPECTED_APPLICATION_COMMIT || '')
      || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
      throw new Error('Release 测试必须使用本轮校验过的回环服务器');
    }
  } else if (url.protocol !== 'https:' || !['h5.page.shafayouxi.org', 'h5.shafayouxi.org'].includes(url.hostname)) {
    throw new Error('测试地址必须是 staging HTTPS 地址或已校验的 Release 服务器');
  }
  return url.href;
}
