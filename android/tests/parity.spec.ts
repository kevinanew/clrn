import { test, locale } from '../fixtures';
import { androidScenarios } from '../scenarios';
import { navigateScenario, signIn } from '../navigation';
import { compareScreenshot } from '../device';

for (const scenario of androidScenarios(locale)) {
  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({ application }, testInfo) => {
    testInfo.annotations.push({ type: 'web-scenario', description: scenario.label });
    if (scenario.signIn && !application.signedIn) {
      await signIn(application.device);
      application.signedIn = true;
    }
    await navigateScenario(application.device, scenario);
    await compareScreenshot(application.device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}`, testInfo);
  });
}
