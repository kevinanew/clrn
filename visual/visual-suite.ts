export type VisualSuite = 'all' | 'app' | 'texas' | 'zhajinhua';

/**
 * 读取并校验视觉套件配置，缺失时运行全部套件。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getVisualSuite(env: NodeJS.ProcessEnv = process.env): VisualSuite {
  const suite = env.VISUAL_SUITE || 'all';
  if (suite !== 'all' && suite !== 'app' && suite !== 'texas' && suite !== 'zhajinhua') {
    throw new Error(`VISUAL_SUITE 无效: "${suite}"。可用值: all, app, texas, zhajinhua`);
  }
  return suite;
}

/**
 * 以功能组划分，建房表单仍属于应用，真实牌桌分别属于 texas 和 zhajinhua。
 * @param scenarios - 当前候选视觉场景清单。
 * @param suite - 要保留的视觉套件。
 */
export function selectVisualSuite<T extends { group: string }>(scenarios: T[], suite: VisualSuite): T[] {
  if (suite === 'all') return scenarios;
  return scenarios.filter(/** 按当前套件选择德州、炸金花或其他普通视觉场景。
 * @param scenario - 当前测试场景配置。 */ scenario => {
    if (suite === 'texas') return scenario.group === 'texas-holdem';
    if (suite === 'zhajinhua') return scenario.group === 'zhajinhua';
    return scenario.group !== 'texas-holdem' && scenario.group !== 'zhajinhua';
  });
}
