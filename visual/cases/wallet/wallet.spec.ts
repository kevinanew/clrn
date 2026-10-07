import { test } from '@playwright/test';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';

for (const scenario of buildScenarios().filter(item => item.group === 'wallet')) {
  test(scenario.label, async ({ browser }) => runVisualScenario(scenario, browser));
}
