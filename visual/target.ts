/** 视觉回归只访问已部署的 staging，不依赖应用源码或本地服务器。 */
export function readVisualUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(env.VISUAL_BASE_URL || 'https://h5.page.shafayouxi.org/');
  const stagingHosts = ['h5.page.shafayouxi.org', 'h5.shafayouxi.org'];
  if (url.protocol !== 'https:' || !stagingHosts.includes(url.hostname)) {
    throw new Error('VISUAL_BASE_URL 必须是已部署的来玩 staging HTTPS 地址');
  }
  return url.href;
}

export const visualBaseUrl = readVisualUrl();
