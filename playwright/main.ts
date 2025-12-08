import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

import { logEarlyReturn } from './util';
import { runLoginPage } from './page/login_page';
import { loadEnv } from './env';
import { runLotRequestPage } from './page/lot_request_page';
import { runConfirmationPage } from './page/confirmation_page';
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

    const groupUrls = await fetchGroupUrlsAfterLogin();
    logEarlyReturn(`Fetched ${groupUrls.length} group URLs for Playwright run.`);
    console.log(groupUrls);
    
    // await runLotRequestPage(page);
    // await runConfirmationPage(page);

  } catch (error) {
    logEarlyReturn(
      `Login flow failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    await browser?.close();
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

async function fetchGroupUrlsAfterLogin(): Promise<string[]> {
  const groupId = process.env.PLAYWRIGHT_GROUP_ID ?? process.env.GROUP_ID;
  const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (!groupId) {
    logEarlyReturn('PLAYWRIGHT_GROUP_ID is not set; skipping Firestore URL fetch.');
    return [];
  }

  if (!apiBaseUrl) {
    logEarlyReturn('PLAYWRIGHT_API_BASE_URL is not set; skipping API fetch.');
    return [];
  }

  try {
    const requestUrl = await fetch(`${apiBaseUrl}/api/groups/urls?groupId=${groupId}`);
    const data = await requestUrl.json();
    return data.urls.filter((url: string): url is string => typeof url === 'string' && url.length > 0);
  } catch (error) {
    logEarlyReturn(`Failed to fetch group URLs: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
