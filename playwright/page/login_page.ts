import type { Locator, Page } from '@playwright/test';
import { captureScreenshot, logEarlyReturn, logPhase, throwLoggedError } from '../util';
import { ACTION_TIMEOUT_MS, getVisibleButton } from '../ui';

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
  } catch (error) {
    const info = error instanceof Error ? error.message : String(error);
    logPhase('login', `Login link not found; checking authenticated state. ${info}`);
    await assertLoggedIn(page);
    return;
  }

  logPhase('login', 'Login link found; clicking.');
  await loginBtn.click({ timeout: ACTION_TIMEOUT_MS });

  logPhase('login', 'Waiting for login page navigation.');
  await page.waitForURL(current => current.toString().startsWith(LOGIN_URL), {
    timeout: 10_000,
  });
  logPhase('login', `Login page loaded: ${page.url()}`);

  await submitLoginForm(page);
}

export function getLoggedInIndicator(page: Page): Locator {
  return page.locator('a[href*="/Logout"], form[action*="/Logout"]')
    .or(page.getByText('ログアウト', { exact: true }))
    .or(page.locator('div.SideNav_pocket').filter({ hasText: 'ログイン中' }))
    .first();
}

async function assertLoggedIn(page: Page): Promise<void> {
  await getLoggedInIndicator(page).waitFor({ state: 'attached', timeout: ACTION_TIMEOUT_MS });
  if (isLoginPage(page.url())) {
    throwLoggedError('[login] Login page is still displayed.');
  }
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
      getVisibleButton(page, 'ログイン').click({ timeout: ACTION_TIMEOUT_MS }),
    ]);
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {
      logPhase('login', 'Login destination did not reach domcontentloaded within 5000ms; continuing after URL change.');
    });
    await assertLoggedIn(page);
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
  await page.waitForURL(url => !isLoginPage(url.toString()), { timeout: 15_000, waitUntil: 'commit' });
}
