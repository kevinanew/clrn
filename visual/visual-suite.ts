export type VisualSuite = 'all' | 'app' | 'texas' | 'zhajinhua';

/**
 * 读取并校验视觉套件配置，缺失时运行全部套件。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getVisualSuite(env: NodeJS.ProcessEnv = process.env): VisualSuite {
  return parseVisualSuite(env.VISUAL_SUITE);
}

/**
 * 校验有效套件，空值继续运行全部套件。
 * @param raw - 原始环境配置。
 */
function parseVisualSuite(raw: string | undefined): VisualSuite {
  const suite = raw || 'all';
  if (!['all', 'app', 'texas', 'zhajinhua'].includes(suite)) {
    throw new Error(`VISUAL_SUITE 无效: "${suite}"。可用值: all, app, texas, zhajinhua`);
  }
  return suite as VisualSuite;
}

/**
 * 以功能组划分，建房表单仍属于应用，真实牌桌分别属于 texas 和 zhajinhua。
 * @param scenarios - 当前候选视觉场景清单。
 * @param suite - 要保留的视觉套件。
 */
export function selectVisualSuite<T extends { group: string }>(scenarios: T[], suite: VisualSuite): T[] {
  if (suite === 'all') return scenarios;
  const groups = { texas: ['texas-holdem'], zhajinhua: ['zhajinhua'], app: ['texas-holdem', 'zhajinhua'] }[suite];
  return scenarios.filter(scenario => groups.includes(scenario.group) !== (suite === 'app'));
}
