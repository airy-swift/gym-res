import type { Page } from '@playwright/test';
import { captureScreenshot, logEarlyReturn, logPhase } from '../util';

const LOGIN_URL = 'https://yoyaku.harp.lg.jp/sapporo/Login';

export async function runLoginPage(page: Page): Promise<void> {
  logPhase('login', `Start login flow from ${page.url()}`);
  const loginBtn = page.getByRole('link', { name: 'ログインする' });
  try {
    logPhase('login', 'Waiting for login link.');
    await loginBtn.waitFor({ timeout: 5_000 });
    logPhase('login', 'Login link found; clicking.');
    await loginBtn.click();
  } catch (error) {
    const info = error instanceof Error ? error.message : String(error);
    logPhase('login', `Login button not found; continuing without login. ${info}`);
    return;
  }

  logPhase('login', 'Waiting for login page navigation.');
  await page.waitForURL(current => current.toString().startsWith(LOGIN_URL), {
    timeout: 10_000,
  });
  logPhase('login', `Login page loaded: ${page.url()}`);

  logPhase('login', 'Filling login form fields.');
  await page.fill('input[name="userId"]', process.env.SERVICE_USER ?? '');
  await page.fill('input[name="password"]', process.env.SERVICE_PASS ?? '');
  try {
    logPhase('login', 'Submitting login form.');
    await Promise.all([
      page.waitForURL(current => !current.toString().startsWith(LOGIN_URL), {
        timeout: 15_000,
      }),
      page.getByRole('button', { name: 'ログイン', exact: true }).click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    logPhase('login', `Login completed; current URL: ${page.url()}`);
  } catch (error) {
    const screenshotPath = await captureScreenshot(page, 'debug');
    const info = error instanceof Error ? error.message : String(error);
    logEarlyReturn(`[login] Login submit failed; captured ${screenshotPath}. ${info}`);
    throw error;
  }
}
