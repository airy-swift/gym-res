import type { Page } from '@playwright/test';

export async function captureScreenshot(page: Page, label: string): Promise<void> {
  await page.screenshot({ path: `${label}.png`, fullPage: true });
}

export function logEarlyReturn(message: string): void {
  console.log(`[pw] ${message}`);
}
