import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

import { logEarlyReturn } from './util';
import { runLoginPage } from './page/login_page';
import { loadEnv } from './env';
import { LOT_REQUEST_URL, runLotRequestPage } from './page/lot_request_page';
import { runConfirmationPage } from './page/confirmation_page';
import { ensureRequestStatusPage } from './page/request_status_page';
import { deriveUdParam, fetchRepresentativeEntries } from './main-util';
// Placeholder configuration values. Replace with the real ones when wiring this up.
export const HEADLESS = false;
export const CANCEL_URL = 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=1&p=1&s=10';

loadEnv();

export async function main(): Promise<void> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext();
    page = await context.newPage();

    await page.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
    await runLoginPage(page);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // 代表が予約して欲しい枠
    const representativeEntries = await fetchRepresentativeEntries();
    logEarlyReturn(`Fetched ${representativeEntries.length} representative entries for Playwright run.`);

    // 今のアカウントが既に応募済みの枠
    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const requestStatusEntries = await ensureRequestStatusPage(page);
    
    for (const entry of representativeEntries) {
      logEarlyReturn(`Processing representative entry: ${entry.gymName} / ${entry.room} / ${entry.date} ${entry.time}`);

      const udParam = deriveUdParam(entry.date);
      if (!udParam) {
        logEarlyReturn(`Skipping entry due to invalid date format: ${entry.date}`);
        continue;
      }

      const lotUrl = `https://yoyaku.harp.lg.jp/sapporo/?u%5B0%5D=28&ud=${udParam}`;
      await page.goto(lotUrl, { waitUntil: 'domcontentloaded' });
      // await runLotRequestPage(page, requestStatusEntries);
      // await runConfirmationPage(page);
    }
  } catch (error) {
    logEarlyReturn(
      `Login flow failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    // await browser?.close();
  }
}

const executedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (executedDirectly) {
  main().catch(error => {
    console.error('Fatal error during login flow', error);
    process.exitCode = 1;
  });
}
