import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

import { fetchRepresentativeEntries, logEarlyReturn } from './util';
import type { RepresentativeEntry } from './types';
import { runLoginPage } from './page/login_page';
import { loadEnv } from './env';
import { LOT_REQUEST_URL, runLotRequestPage } from './page/lot_request_page';
import { runConfirmationPage } from './page/confirmation_page';
import { ensureRequestStatusPage } from './page/request_status_page';
import { runSearchPage } from './page/search_page';
import { runFacilitySearchPage } from './page/facility_search_page';
import { runFacilityAvailabilityPage } from './page/facility_availability';
// Placeholder configuration values. Replace with the real ones when wiring this up.
export const HEADLESS = false;
export const CANCEL_URL = 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=1&p=1&s=10';
const LOG_FILE_PATH = path.resolve(process.cwd(), 'log.txt');

loadEnv();

export async function main(): Promise<void> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  const successEntries: RepresentativeEntry[] = [];
  const failedEntries: RepresentativeEntry[] = [];

  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext();
    page = await context.newPage();

    await page.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
    await runLoginPage(page);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // 代表が予約して欲しい枠
    const representativeEntries = await fetchRepresentativeEntries();

    // 今のアカウントが既に応募済みの枠
    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const requestStatusEntries = await ensureRequestStatusPage(page);
    const pendingEntries = representativeEntries.filter(entry => {
      const exists = requestStatusEntries.some(requested =>
        requested.gymName === entry.gymName &&
        requested.room === entry.room &&
        requested.date === entry.date &&
        requested.time === entry.time,
      );
      return !exists;
    });

    for (const entry of pendingEntries) {
      logEarlyReturn(`Processing representative entry: ${entry.gymName} / ${entry.room} / ${entry.date} ${entry.time}`);

      try {
        await runSearchPage(page, entry);
        await runFacilitySearchPage(page);
        await runFacilityAvailabilityPage(page, entry);
        await runLotRequestPage(page, requestStatusEntries);
        const confirmed = await runConfirmationPage(page);
        if (confirmed) {
          successEntries.push(entry);
        } else {
          failedEntries.push(entry);
        }
      } catch (entryError) {
        failedEntries.push(entry);
        logEarlyReturn(
          `Entry failed (${entry.gymName} / ${entry.room} / ${entry.date} ${entry.time}): ${entryError instanceof Error ? entryError.message : String(entryError)}`,
        );
      }
    }

    if (successEntries.length > 0 || failedEntries.length > 0) {
      console.log('Reservation results summary');
      successEntries.forEach(entry => {
        console.log('SUCCESS', formatEntry(entry));
      });
      failedEntries.forEach(entry => {
        console.log('FAILED', formatEntry(entry));
      });
    }
  } catch (error) {
    logEarlyReturn(
      `Login flow failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    await browser?.close();
    await persistLogFile(successEntries, failedEntries);
  }
}

function formatEntry(entry: RepresentativeEntry): string {
  const gym = entry.gymName || '施設未指定';
  const room = entry.room || '部屋未指定';
  const date = entry.date || '日付未指定';
  const time = entry.time || '時間未指定';
  return `${gym} / ${room} / ${date} ${time}`;
}

async function persistLogFile(
  successEntries: RepresentativeEntry[],
  failedEntries: RepresentativeEntry[],
): Promise<void> {
  const summaryLine = `成功${successEntries.length}件 失敗${failedEntries.length}件`;
  const failureLines = failedEntries.length > 0
    ? failedEntries.map(formatEntry)
    : ['失敗はありませんでした。'];
  const logContent = [summaryLine, ...failureLines].join('\n');

  try {
    await fs.writeFile(LOG_FILE_PATH, logContent, 'utf8');
  } catch (logError) {
    console.error('Failed to write log file', logError);
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
