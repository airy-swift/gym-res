import type { Page } from '@playwright/test';
import { logEarlyReturn } from '../util';

const LOGIN_URL = 'https://yoyaku.harp.lg.jp/sapporo/Login';

export async function runLoginPage(page: Page): Promise<void> {
  const loginBtn = page.getByRole('link', { name: 'ログインする' });
  try {
    await loginBtn.waitFor({ timeout: 5_000 });
    await loginBtn.click();
  } catch (error) {
    const info = error instanceof Error ? error.message : String(error);
    logEarlyReturn(`Login button not found; continuing without login. ${info}`);
    return;
  }

  await page.waitForURL(current => current.toString().startsWith(LOGIN_URL), {
    timeout: 10_000,
  });

  await page.fill('input[name="userId"]', process.env.SERVICE_USER ?? '');
  await page.fill('input[name="password"]', process.env.SERVICE_PASS ?? '');
  await Promise.all([
    page.waitForURL(current => !current.toString().startsWith(LOGIN_URL), {
      timeout: 15_000,
    }),
    page.getByRole('button', { name: 'ログイン', exact: true }).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
}
