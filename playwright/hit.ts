import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

import { cleanupJobCredentials, logEarlyReturn, saveApplicationHits } from './util';
import { loadEnv } from './env';
import { runLoginPage } from './page/login_page';
import type { RepresentativeEntry } from './types';
import { ensureRequestStatusPage, REQUEST_STATUS_FILTERS } from './page/request_status_page';

export const HEADLESS = false;
export const HIT_STATUS_URL = 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20';

loadEnv();

export async function main(): Promise<void> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      // viewport: { width: 3000, height: 1080 },
    });
    page = await context.newPage();

    await page.goto(HIT_STATUS_URL, { waitUntil: 'domcontentloaded' });
    await runLoginPage(page);
    await cleanupJobCredentials();
    await page.waitForTimeout(1_000);

    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const hits = await ensureRequestStatusPage(page, REQUEST_STATUS_FILTERS[0]);
    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const fixed = await ensureRequestStatusPage(page, REQUEST_STATUS_FILTERS[2]);

    await persistHitSummary(hits, fixed);
    logEarlyReturn(`Hit status summary: hits=${hits.length}, fixed=${fixed.length}`);

    console.log(hits);
    console.log(fixed);
  } catch (error) {
    logEarlyReturn(
      `Hit status check setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    await browser?.close();
  }
}

async function persistHitSummary(hits: RepresentativeEntry[], fixed: RepresentativeEntry[]): Promise<void> {
  const groupId = (process.env.PLAYWRIGHT_GROUP_ID ?? process.env.GROUP_ID ?? '').trim();
  if (!groupId) {
    logEarlyReturn('PLAYWRIGHT_GROUP_ID is not set; skipping hit summary save.');
    return;
  }

  const timestamp = Date.now().toString();
  const lines = buildStandardizedHitLines(hits, fixed);
  const saved = await saveApplicationHits({ groupId, timestamp, hits: lines });
  logEarlyReturn(`Saved standardized hit lines: ${saved ? lines.length : 0}/${lines.length}`);
}

function buildStandardizedHitLines(hits: RepresentativeEntry[], fixed: RepresentativeEntry[]): string[] {
  const hitLines = hits.map(entry => formatHitLine('HIT', entry));
  const fixedLines = fixed.map(entry => formatHitLine('FIXED', entry));
  return Array.from(new Set([...hitLines, ...fixedLines]));
}

function formatHitLine(status: 'HIT' | 'FIXED', entry: RepresentativeEntry): string {
  const normalize = (value?: string) => (value ?? '').replace(/\s+/g, ' ').trim() || '-';
  return [
    status,
    normalize(entry.date),
    normalize(entry.time),
    normalize(entry.gymName),
    normalize(entry.room),
  ].join('\t');
}

const executedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (executedDirectly) {
  main().catch(error => {
    console.error('Fatal error during hit status setup', error);
    process.exitCode = 1;
  });
}
