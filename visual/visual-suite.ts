export type VisualSuite = 'all' | 'app' | 'texas';

export function getVisualSuite(env: NodeJS.ProcessEnv = process.env): VisualSuite {
  const suite = env.VISUAL_SUITE || 'all';
  if (suite !== 'all' && suite !== 'app' && suite !== 'texas') {
    throw new Error(`VISUAL_SUITE 无效: "${suite}"。可用值: all, app, texas`);
  }
  return suite;
}

/** 以功能组划分，建房表单仍属于应用，只有真实德州牌桌属于 texas。 */
export function selectVisualSuite<T extends { group: string }>(scenarios: T[], suite: VisualSuite): T[] {
  if (suite === 'all') return scenarios;
  return scenarios.filter(scenario => {
    const isTexasTable = scenario.group === 'texas-holdem';
    return suite === 'texas' ? isTexasTable : !isTexasTable;
  });
}
