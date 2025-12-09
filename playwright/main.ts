import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

import { captureScreenshot, fetchRepresentativeEntries, logEarlyReturn } from './util';
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
  let skippedCount = 0;

  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });
    page = await context.newPage();

    await page.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
    await runLoginPage(page);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // 代表が予約して欲しい枠
    const representativeEntries = await fetchRepresentativeEntries();

    // 今のアカウントが既に応募済みの枠
    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const requestStatusEntries = await ensureRequestStatusPage(page);
    console.log('requestStatusEntries', requestStatusEntries);
    console.log('representativeEntries', representativeEntries);

    const pendingEntries = representativeEntries.filter(entry => {
      const normalizedEntry = normalizeEntry(entry);
      const matched = requestStatusEntries.find(requested => {
        const normalizedRequested = normalizeEntry(requested);
        return (
          normalizedRequested.gymName === normalizedEntry.gymName &&
          normalizedRequested.room === normalizedEntry.room &&
          normalizedRequested.date === normalizedEntry.date &&
          normalizedRequested.time === normalizedEntry.time
        );
      });

      if (matched) {
        skippedCount += 1;
        return false;
      }
      return true;
    });

    for (let index = 0; index < pendingEntries.length; index += 1) {
      const entry = pendingEntries[index];
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
        const errorMessage = entryError instanceof Error ? entryError.message : String(entryError);
        const stackTrace = entryError instanceof Error && entryError.stack ? `\nStacktrace:\n${entryError.stack}` : '';
        logEarlyReturn(
          `Entry failed (${entry.gymName} / ${entry.room} / ${entry.date} ${entry.time}): ${errorMessage}${stackTrace}`,
        );
      }

      if (index < pendingEntries.length - 1) {
        await page.waitForTimeout(5_000);
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
      console.log(`Skipped entries: ${skippedCount}`);
    }
  } catch (error) {
    logEarlyReturn(
      `Login flow failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    if (page) {
      try {
        await captureScreenshot(page, 'debug');
      } catch (screenshotError) {
        console.error('Failed to capture debug screenshot', screenshotError);
      }
    }
    await browser?.close();
    await persistLogFile(successEntries, failedEntries, skippedCount);
  }
}

function formatEntry(entry: RepresentativeEntry): string {
  const gym = entry.gymName || '施設未指定';
  const room = entry.room || '部屋未指定';
  const date = entry.date || '日付未指定';
  const time = entry.time || '時間未指定';
  return `${gym} / ${room} / ${date} ${time}`;
}

function normalizeEntry(entry: RepresentativeEntry): RepresentativeEntry {
  return {
    gymName: normalizeText(entry.gymName),
    room: normalizeText(entry.room),
    date: normalizeDate(entry.date),
    time: normalizeText(entry.time),
  };
}

const normalizeText = (value?: string | null) => (value ?? '').replace(/\s+/g, '').trim();

function normalizeDate(date: string) {
  return date
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/年0?/g, '年')
    .replace(/月0?/g, '月');
}


async function persistLogFile(
  successEntries: RepresentativeEntry[],
  failedEntries: RepresentativeEntry[],
  skippedCount: number,
): Promise<void> {
  const summaryLine = `成功${successEntries.length}件 失敗${failedEntries.length}件 スキップ${skippedCount}件`;
  const failureLines = failedEntries.length > 0
    ? failedEntries.map(entry => `失敗: ${formatEntry(entry)}`)
    : ['失敗はありませんでした。'];
  const skipMessage = skippedCount > 0 ? '一部の候補は既に予約済みのためスキップしました。' : undefined;
  const logLines = [summaryLine, ...failureLines];
  if (skipMessage) {
    logLines.push(skipMessage);
  }
  const logContent = logLines.join('\n');

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
