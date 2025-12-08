import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { logEarlyReturn } from './util';
import { runLoginPage } from './page/login_page';
import { loadEnv } from './env';
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
  } catch (error) {
    // if (page) {
    //   await captureScreenshot(page, 'login-error');
    // }
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
