import { test } from '@playwright/test';
import { loadEnv } from '../env';
import { runLoginPage } from '../page/login_page';

const CANCEL_URL = 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=1&p=1&s=10';

loadEnv();

test('user can login via Playwright flow', async ({ page }) => {
  await page.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
  await runLoginPage(page);
});
