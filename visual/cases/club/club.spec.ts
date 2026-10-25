import { test } from '@playwright/test';
import { buildScenarios } from '../../scenarios';
import { runVisualScenario } from '../runScenario';
import { runClubSearchResultScenario } from './searchResult';

for (const scenario of buildScenarios().filter(item => item.group === 'club')) {
  test(scenario.label, async ({ browser }) => scenario.pageLabel === 'signed_in_club_search_result'
    ? runClubSearchResultScenario(scenario, browser)
    : runVisualScenario(scenario, browser));
}
