/** 视觉回归优先使用本轮 Release 服务器，本地手动运行保留 Staging 入口。 */
import { readTestWebUrl } from '../e2e/helpers/web-target';

/**
 * 返回所有视觉场景共用的测试地址。
 * @param env - 环境配置，默认读取当前进程。
 */
export function readVisualUrl(env: NodeJS.ProcessEnv = process.env): string {
  return readTestWebUrl(env.VISUAL_BASE_URL, env);
}

export const visualBaseUrl = readVisualUrl();
