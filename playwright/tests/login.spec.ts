import { test } from '@playwright/test';
import { loadEnv } from '../env';
import { runLoginPage } from '../page/login_page';
import { CANCEL_URL } from '../main';

loadEnv();

test('user can login via Playwright flow', async ({ page }) => {
  await page.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
  await runLoginPage(page);
});
