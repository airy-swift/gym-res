import { logEarlyReturn } from "../util";
import type { Page } from '@playwright/test';

const TARGET_URL = 'https://yoyaku.harp.lg.jp/sapporo/ReservationRequests/Insert';

export async function runLotRequestPage(page: Page): Promise<void> {
    try {
        await page.waitForURL((url) => url.toString().startsWith(TARGET_URL), {timeout: 10_000});
    } catch (error) {
        console.warn('Failed to wapture screenshot (runNewApplicationPage):', error);
    }

        
  // await new Promise(resolve => setTimeout(resolve, 3_000));
  const dropdownOption = page.locator('div[role="combobox"]', { hasText: 'バドミントン' });
  await dropdownOption.first().waitFor({ state: 'visible', timeout: 10_000 });
  await dropdownOption.first().click();

  // await new Promise(resolve => setTimeout(resolve, 3_000));
  const participantsInput = page.locator('[id^="input-55"]');
  await participantsInput.waitFor({ state: 'visible', timeout: 10_000 });
  await participantsInput.fill('20');

  const confirmButton = page.getByRole('button', { name: '確認' });
  await confirmButton.waitFor({ state: 'visible', timeout: 10_000 });
  await confirmButton.click({ force: true });
}
