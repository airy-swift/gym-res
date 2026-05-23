import type { Page } from '@playwright/test';
import { captureScreenshot, logEarlyReturn, logPhase, throwLoggedError } from '../util';

const LOGIN_URL = 'https://yoyaku.harp.lg.jp/sapporo/Login';

export async function runLoginPage(page: Page): Promise<void> {
  logPhase('login', `Start login flow from ${page.url()}`);
  if (isLoginPage(page.url())) {
    logPhase('login', `Login page already loaded: ${page.url()}`);
    await submitLoginForm(page);
    return;
  }

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

  await submitLoginForm(page);
}

async function submitLoginForm(page: Page): Promise<void> {
  const serviceUser = process.env.SERVICE_USER ?? '';
  const servicePass = process.env.SERVICE_PASS ?? '';
  if (!serviceUser || !servicePass) {
    throwLoggedError('[login] SERVICE_USER or SERVICE_PASS is not set.');
  }

  logPhase('login', 'Filling login form fields.');
  await page.fill('input[name="userId"]', serviceUser);
  await page.fill('input[name="password"]', servicePass);
  try {
    logPhase('login', 'Submitting login form.');
    await Promise.all([
      waitForUrlToLeaveLoginPage(page),
      page.getByRole('button', { name: 'ログイン', exact: true }).click(),
    ]);
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {
      logPhase('login', 'Login destination did not reach domcontentloaded within 5000ms; continuing after URL change.');
    });
    logPhase('login', `Login completed; current URL: ${page.url()}`);
  } catch (error) {
    let screenshotPath = '';
    try {
      screenshotPath = await captureScreenshot(page, 'debug');
    } catch (screenshotError) {
      const screenshotInfo = screenshotError instanceof Error ? screenshotError.message : String(screenshotError);
      logEarlyReturn(`[login] Failed to capture login debug screenshot. ${screenshotInfo}`);
    }
    const info = error instanceof Error ? error.message : String(error);
    const screenshotMessage = screenshotPath ? ` captured ${screenshotPath}.` : '';
    logEarlyReturn(`[login] Login submit failed;${screenshotMessage} ${info}`);
    throw error;
  }
}

function isLoginPage(url: string): boolean {
  return url.startsWith(LOGIN_URL);
}

async function waitForUrlToLeaveLoginPage(page: Page): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!isLoginPage(page.url())) {
      return;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for login redirect. currentUrl=${page.url()}`);
}
