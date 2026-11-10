/** 统一校验测试入口，仅允许指定 Staging 站点或本轮 Release 包的回环服务器。 */

/**
 * 拒绝协议、主机和端口之外的 URL 字段。
 * @param url - 已解析的入口。
 */
function validateBareUrl(url: URL): void {
  const forbidden = [url.username, url.password, url.pathname !== '/', url.search, url.hash];
  if (forbidden.some(Boolean)) throw new Error('测试入口只能包含协议、主机和端口');
}

/**
 * 校验 Release 服务器与固定应用提交绑定。
 * @param url - 回环入口。
 * @param environment - 本轮服务器环境。
 */
function validateRelease(url: URL, environment: NodeJS.ProcessEnv): void {
  const valid = [environment.CLRN_RELEASE_WEB_ROOT,
    /^[a-f0-9]{40}$/.test(environment.CLRN_EXPECTED_APPLICATION_COMMIT || ''),
    url.protocol === 'http:', url.hostname === '127.0.0.1', url.port];
  if (!valid.every(Boolean)) throw new Error('Release 测试必须使用本轮校验过的回环服务器');
}

/**
 * 拒绝非预期 staging 站点。
 * @param url - 普通入口。
 */
function validateStaging(url: URL): void {
  if (url.protocol !== 'https:' || !['h5.page.shafayouxi.org', 'h5.shafayouxi.org'].includes(url.hostname)) {
    throw new Error('测试地址必须是 staging HTTPS 地址或已校验的 Release 服务器');
  }
}

/**
 * 选择普通配置的地址或既有默认 staging 地址。
 * @param address - 普通测试地址。
 */
function stagingAddress(address: string | undefined): string {
  return address || 'https://h5.page.shafayouxi.org/';
}

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
  return validatedUrl(releaseAddress, address, environment);
}

/**
 * 根据入口模式执行校验，保留 URL 规范化结果。
 * @param releaseAddress - 本轮 Release 地址。
 * @param address - 普通配置地址。
 * @param environment - 本轮环境。
 */
function validatedUrl(releaseAddress: string | undefined, address: string | undefined, environment: NodeJS.ProcessEnv): string {
  const url = new URL(releaseAddress || stagingAddress(address));
  validateBareUrl(url);
  if (releaseAddress) validateRelease(url, environment);
  else validateStaging(url);
  return url.href;
}
