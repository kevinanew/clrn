import { expect, type Page } from '@playwright/test';
import { environment } from './environment';

export async function expectSiteReady(page: Page, siteUrl: string): Promise<void> {
  await expect(page).toHaveTitle(/来玩/);
  await expect(page.locator('#root')).toBeVisible();
  await expect
    .poll(
      async () => {
        const loadingVisible = await page
          .locator('.loading-container')
          .isVisible()
          .catch(() => false);
        const rootText = (
          await page
            .locator('#root')
            .innerText()
            .catch(() => '')
        ).trim();
        return !loadingVisible && rootText.length > 0;
      },
      { message: `${siteUrl} 应用未能完成首屏加载`, timeout: 45_000 },
    )
    .toBeTruthy();
}

export async function expectBuildVersion(page: Page, siteUrl: string): Promise<void> {
  const buildVersion = await page.locator('meta[name="build-version"]').getAttribute('content');
  expect(buildVersion, `${siteUrl} 应提供 build-version`).toMatch(
    /^[a-f0-9]{7,}\s+-\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/i,
  );
  expect(
    buildVersion?.toLowerCase(),
    `${siteUrl} 应已部署提交 ${environment.expectedBuildSha}`,
  ).toMatch(new RegExp(`^${environment.expectedBuildSha}`));
}
