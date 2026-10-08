import { getVisualSuite } from './visual-suite';

export const APP_TEST_USERNAME = 'laiwanvisual01';
export const TEXAS_TEST_USERNAME = 'laiwanvisualtexas01';

/** 德州与应用分别登录固定 staging 账号，避免相互作废 token。 */
export function getVisualTestAccount(env: NodeJS.ProcessEnv = process.env) {
  return {
    username: env.VISUAL_USERNAME || (getVisualSuite(env) === 'texas' ? TEXAS_TEST_USERNAME : APP_TEST_USERNAME),
    password: env.VISUAL_PASSWORD || 'visual2026test',
  };
}

/** 只允许为两套固定测试账号补钻，不扩大到任意覆盖凭据的用户。 */
export function canTopUpVisualAccount(username: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (username === APP_TEST_USERNAME || username === TEXAS_TEST_USERNAME)
    && username === getVisualTestAccount(env).username;
}
