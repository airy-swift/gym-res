import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

import { captureScreenshot, fetchJob, fetchRepresentativeEntries, logEarlyReturn, updateJobProgress } from './util';
import type { RepresentativeEntry } from './types';
import { runLoginPage } from './page/login_page';
import { loadEnv } from './env';
import { LOT_REQUEST_URL, runLotRequestPage } from './page/lot_request_page';
import { runConfirmationPage } from './page/confirmation_page';
import { ensureRequestStatusPage } from './page/request_status_page';
import { runSearchPage } from './page/search_page';
import { runFacilitySearchPage } from './page/facility_search_page';
import { runFacilityAvailabilityPage } from './page/facility_availability';
import { runFacilityAvailabilityComparisonPage } from './page/facility_availability_comparison';
import { runSeekLotComparePage } from './page/seek_lot_compare_page';
import { sendLineNotification } from './util';
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
  let cancelledCount = 0;
  let expectedEntryTotal: number | null = null;
  let totalEntries = 0;
  let screenshotCaptured = false;

  const ensureScreenshot = async (): Promise<void> => {
    if (screenshotCaptured || !page) {
      return;
    }
    try {
      await captureScreenshot(page, 'debug');
      screenshotCaptured = true;
    } catch (screenshotError) {
      console.error('Failed to capture debug screenshot', screenshotError);
    }
  };

  const syncResultCounts = (): void => {
    const expected = expectedEntryTotal ?? (totalEntries || null);
    if (expected === null) {
      return;
    }
    const recorded = successEntries.length + failedEntries.length + skippedCount + cancelledCount;
    if (recorded >= expected) {
      return;
    }
    const adjustment = expected - recorded;
    cancelledCount += adjustment;
    logEarlyReturn(`Adjusted cancelled count by ${adjustment} to match expected entries (${expected}).`);
  };

  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 2700, height: 1080 },
    });
    page = await context.newPage();

    const job = await fetchJob();
    const jobEntryCount = job?.entryCount ?? null;
    if (jobEntryCount !== null) {
      expectedEntryTotal = jobEntryCount;
    }

    await page.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
    await runLoginPage(page);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // 代表が予約して欲しい枠
    let representativeEntries = await fetchRepresentativeEntries();
    if (jobEntryCount !== null) {
      if (jobEntryCount - representativeEntries.length > 0) {
        await updateJobProgress(`追加分の探索中...`);
        const additionalEntries = await runSeekLotComparePage(page, jobEntryCount - representativeEntries.length);
        representativeEntries = [...representativeEntries, ...additionalEntries];
      } else {
        representativeEntries = representativeEntries.slice(0, jobEntryCount);
      }
      console.log('応募先の枠: ', representativeEntries);
    }

    totalEntries = representativeEntries.length;
    if (expectedEntryTotal === null) {
      expectedEntryTotal = totalEntries;
    }
    await updateJobProgress(`${0}/${totalEntries}件`);

    // 今のアカウントが既に応募済みの枠
    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const requestStatusEntries = await ensureRequestStatusPage(page);

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

    let processedCount = skippedCount;
    await updateJobProgress(`${Math.min(processedCount, totalEntries)}/${totalEntries}件`);

    for (let index = 0; index < pendingEntries.length; index += 1) {
      const entry = pendingEntries[index];
      logEarlyReturn(`Processing representative entry: ${entry.gymName} / ${entry.room} / ${entry.date} ${entry.time}`);

      try {
        await runSearchPage(page, entry);
        await runFacilitySearchPage(page);
        await runFacilityAvailabilityComparisonPage(page, entry);
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

      processedCount += 1;
      await updateJobProgress(`${Math.min(processedCount, totalEntries)}/${totalEntries}件`);
    }

    syncResultCounts();
    if (successEntries.length > 0 || failedEntries.length > 0 || cancelledCount > 0) {
      console.log('Reservation results summary');
      successEntries.forEach(entry => {
        console.log('SUCCESS', formatEntry(entry));
      });
      failedEntries.forEach(entry => {
        console.log('FAILED', formatEntry(entry));
      });
      console.log(`Skipped entries: ${skippedCount}`);
      if (cancelledCount > 0) {
        console.log(`Cancelled entries: ${cancelledCount}`);
      }
    }
  } catch (error) {
    syncResultCounts();
    await ensureScreenshot();
    logEarlyReturn(
      `Login flow failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    syncResultCounts();
    await ensureScreenshot();
    await browser?.close();
    await persistLogFile(successEntries, failedEntries, skippedCount, cancelledCount);
    await sendLineNotification(`${process.env.PLAYWRIGHT_GROUP_ID}/${process.env.SERVICE_USER}: 成功${successEntries.length}件 失敗${failedEntries.length}件 スキップ${skippedCount}件 キャンセル${cancelledCount}件`);
  }
}

function formatEntry(entry: RepresentativeEntry): string {
  const gym = entry.gymName || '施設未指定';
  const room = entry.room || '部屋未指定';
  const date = entry.date || '日付未指定';
  const time = entry.time || '時間未指定';
  return `${gym} / ${room} / ${date} ${time}`;
}

function formatSuccessSummary(entry: RepresentativeEntry): string {
  const gym = entry.gymName || '施設未指定';
  const room = entry.room || '部屋未指定';
  const date = entry.date || '日付未指定';
  const time = entry.time || '時間未指定';
  return `${date} ${time}に${gym}の${room}を予約しました。`;
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
  cancelledCount: number,
): Promise<void> {
  const summaryLine = `成功${successEntries.length}件 失敗${failedEntries.length}件 スキップ${skippedCount}件 キャンセル${cancelledCount}件`;
  const detailLines = failedEntries.length > 0
    ? failedEntries.map(entry => `失敗: ${formatEntry(entry)}`)
    : successEntries.length > 0
      ? successEntries.map(entry => formatSuccessSummary(entry))
      : ['失敗はありませんでした。'];
  const skipMessage = skippedCount > 0 ? '一部の候補は既に予約済みのためスキップしました。' : undefined;
  const cancelMessage = cancelledCount > 0 ? 'ログイン不可などの理由で処理できなかった枠をキャンセルとして計上しました。' : undefined;
  const logLines = [summaryLine, '', ...detailLines];
  if (skipMessage) {
    logLines.push(skipMessage);
  }
  if (cancelMessage) {
    logLines.push(cancelMessage);
  }
  const logContent = logLines.join('<br>');

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
