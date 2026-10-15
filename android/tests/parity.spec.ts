import { test, locale } from '../fixtures';
import { androidScenarios } from '../scenarios';
import { navigateScenario, signIn } from '../navigation';
import { compareScreenshot } from '../device';
import { screenshotMasks } from '../screenshot';

for (const scenario of androidScenarios(locale, process.env.ANDROID_GROUP)) {
  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({ application }, testInfo) => {
    testInfo.annotations.push({ type: 'web-scenario', description: scenario.label });
    if (scenario.signIn && !application.signedIn) {
      await signIn(application.device);
      application.signedIn = true;
    }
    const backgroundBanner = await navigateScenario(application.device, scenario);
    await compareScreenshot(application.device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}`, testInfo,
      await screenshotMasks(application.device, scenario, backgroundBanner));
  });
}
