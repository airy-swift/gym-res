import type { Page } from '@playwright/test';
import { captureScreenshot, logEarlyReturn } from '../util';

const TARGET_URL = 'https://yoyaku.harp.lg.jp/sapporo/ReservationRequests/InsertConfirm';

const CANCELLATION_KEYWORDS = ['取消料', 'キャンセル料'];

export async function runConfirmationPage(page: Page): Promise<boolean> {
  await page.waitForURL((url) => url.toString().startsWith(TARGET_URL), {
    timeout: 10_000,
  });
  void captureScreenshot(page, 'runConfirmationPage').catch((error) => {
    console.warn('Failed to capture screenshot (runConfirmationPage):', error);
  });

  const acknowledgeCheckbox = page.locator('span', { hasText: '注意事項を確認しました' }).first();
  await acknowledgeCheckbox.waitFor({ state: 'visible', timeout: 10_000 });
  await acknowledgeCheckbox.click();

  const submitButton = page.locator('span', { hasText: '申込確定' }).first();
  await submitButton.waitFor({ state: 'visible', timeout: 10_000 });
  await submitButton.click();

  return true;
}
