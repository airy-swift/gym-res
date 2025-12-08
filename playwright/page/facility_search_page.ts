import type { Page } from '@playwright/test';

const FACILITY_URL_PREFIX = 'https://yoyaku.harp.lg.jp/sapporo/FacilitySearch';

export async function runFacilitySearchPage(page: Page): Promise<void> {
  await page.waitForURL(url => url.toString().startsWith(FACILITY_URL_PREFIX), {
    timeout: 10_000,
  });

  await page.locator('a[href*="/FacilityAvailability/Index/"]:not([href*="rc="]):not([title])').click();


  // const availabilityButton = page.getByRole('link', { name: '空き状況', exact: true }).first();
  // await availabilityButton.waitFor({ state: 'visible', timeout: 10_000 });
  // await availabilityButton.click();
}
