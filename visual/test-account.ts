import { getVisualSuite } from './visual-suite';
import ciManifest from '../scripts/ci-test-accounts.json';
import { createHash } from 'node:crypto';

export const APP_TEST_USERNAME = 'laiwanvisual01';
export const TEXAS_TEST_USERNAME = 'laiwanvisualtexas01';
export const ZHAJINHUA_TEST_USERNAME = 'laiwanvisualzjh01';
const DEFAULT_TEST_PASSWORD = 'visual2026test';

/**
 * 每个账号使用独立且稳定的设备标识，采集登录态与场景注入使用同一值。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getVisualDeviceId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VISUAL_DEVICE_ID) return env.VISUAL_DEVICE_ID;
  const digest = createHash('sha256').update(`clrn-visual:${getVisualTestAccount(env).username.toLowerCase()}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/**
 * 三套视觉测试分别登录固定 staging 账号，避免相互作废 token。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getVisualTestAccount(env: NodeJS.ProcessEnv = process.env) {
  const suite = getVisualSuite(env);
  const defaultUsername = suite === 'texas' ? TEXAS_TEST_USERNAME
    : suite === 'zhajinhua' ? ZHAJINHUA_TEST_USERNAME : APP_TEST_USERNAME;
  return {
    username: env.VISUAL_USERNAME || defaultUsername,
    password: env.VISUAL_PASSWORD || DEFAULT_TEST_PASSWORD,
  };
}

/**
 * 允许为当前使用的固定账号或 GitHub Actions 专用池账号补钻。
 * @param username - 需要判断是否允许测试充值的用户名。
 * @param env - 环境配置，默认读取当前进程。
 */
export function canTopUpVisualAccount(username: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const isFixedTestAccount = username === APP_TEST_USERNAME || username === TEXAS_TEST_USERNAME
    || username === ZHAJINHUA_TEST_USERNAME;
  const isCurrentAccount = username === getVisualTestAccount(env).username;
  const isCiPoolAccount = env.GITHUB_ACTIONS === 'true' && ciManifest.accounts.includes(username);
  return (isFixedTestAccount || isCiPoolAccount) && isCurrentAccount;
}
