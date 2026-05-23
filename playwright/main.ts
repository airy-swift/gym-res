import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type Browser, type Page } from '@playwright/test';

import { captureScreenshot, cleanupJobCredentials, fetchJob, fetchRepresentativeEntries, logEarlyReturn, logPhase, sendLineNotification, updateJobProgress } from './util';
import type { RepresentativeEntry } from './types';
import { runLoginPage } from './page/login_page';
import { loadEnv } from './env';
import { launchChromium } from './browser';
import { runLotRequestPage } from './page/lot_request_page';
import { runConfirmationPage } from './page/confirmation_page';
import { runSearchPage } from './page/search_page';
import { runFacilitySearchPage } from './page/facility_search_page';
import { runFacilityAvailabilityPage } from './page/facility_availability';
import { runFacilityAvailabilityComparisonPage } from './page/facility_availability_comparison';
import { buildReservationPlan } from './reservation_plan';
import { entriesConflictWithExistingRequest, formatEntryLabel } from './entry_utils';

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
    logPhase('setup', 'Launching browser.');
    browser = await launchChromium({ headless: HEADLESS });
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 3000, height: 1080 },
    });
    page = await context.newPage();
    logPhase('setup', 'Browser page created.');

    logPhase('job', 'Fetching job metadata.');
    const job = await fetchJob();
    const jobEntryCount = job?.entryCount ?? null;
    if (jobEntryCount !== null) {
      expectedEntryTotal = jobEntryCount;
      logPhase('job', `Expected entry count: ${jobEntryCount}`);
    } else {
      logPhase('job', 'Expected entry count is not available.');
    }

    logPhase('login', `Navigating to initial page: ${CANCEL_URL}`);
    await page.goto(CANCEL_URL, { waitUntil: 'domcontentloaded' });
    await runLoginPage(page);
    logPhase('login', 'Cleaning up job credentials after login attempt.');
    await cleanupJobCredentials();
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // 代表が予約して欲しい枠
    logPhase('representative', 'Fetching representative entries.');
    const requestedRepresentativeEntries = await fetchRepresentativeEntries();
    logPhase('representative', `Fetched representative entries: ${requestedRepresentativeEntries.length}`);

    const reservationPlan = await buildReservationPlan(page, requestedRepresentativeEntries, jobEntryCount);
    const representativeEntries = reservationPlan.entries;
    const requestStatusEntries = reservationPlan.requestStatusEntries;
    failedEntries.push(...reservationPlan.failedEntries);
    console.log('応募先の枠: ', representativeEntries);

    totalEntries = reservationPlan.totalEntries;
    if (expectedEntryTotal === null) {
      expectedEntryTotal = totalEntries;
    }
    await updateJobProgress(`${Math.min(failedEntries.length, totalEntries)}/${totalEntries}件`);

    const entriesQueuedForThisRun: RepresentativeEntry[] = [];
    const pendingEntries = representativeEntries.filter(entry => {
      const alreadyRequested = requestStatusEntries.some(requested => entriesConflictWithExistingRequest(requested, entry));
      if (alreadyRequested) {
        skippedCount += 1;
        return false;
      }

      const alreadyQueued = entriesQueuedForThisRun.some(queuedEntry => entriesConflictWithExistingRequest(queuedEntry, entry));
      if (alreadyQueued) {
        skippedCount += 1;
        return false;
      }

      entriesQueuedForThisRun.push(entry);
      return true;
    });

    let processedCount = skippedCount + failedEntries.length;
    logPhase('reservation', `Pending entries: ${pendingEntries.length}; skipped entries: ${skippedCount}`);
    await updateJobProgress(`${Math.min(processedCount, totalEntries)}/${totalEntries}件`);

    for (let index = 0; index < pendingEntries.length; index += 1) {
      const entry = pendingEntries[index];
      logPhase('reservation', `Processing representative entry ${index + 1}/${pendingEntries.length}: ${entry.gymName} / ${entry.room} / ${entry.date} ${entry.time}`);

      try {
        logPhase('reservation', 'Running search page.');
        await runSearchPage(page, entry);
        logPhase('reservation', 'Running facility search page.');
        await runFacilitySearchPage(page, entry.room);
        logPhase('reservation', 'Running availability comparison page.');
        await runFacilityAvailabilityComparisonPage(page, entry);
        logPhase('reservation', 'Running facility availability page.');
        await runFacilityAvailabilityPage(page, entry);
        logPhase('reservation', 'Running lot request page.');
        await runLotRequestPage(page, requestStatusEntries);
        logPhase('reservation', 'Running confirmation page.');
        const confirmed = await runConfirmationPage(page);
        if (confirmed) {
          successEntries.push(entry);
          logPhase('reservation', `Entry succeeded: ${formatEntryLabel(entry)}`);
        } else {
          failedEntries.push(entry);
          logPhase('reservation', `Entry not confirmed: ${formatEntryLabel(entry)}`);
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
    logPhase('summary', `Result counts success=${successEntries.length}, failed=${failedEntries.length}, skipped=${skippedCount}, cancelled=${cancelledCount}`);
    if (successEntries.length > 0 || failedEntries.length > 0 || cancelledCount > 0) {
      console.log('Reservation results summary');
      successEntries.forEach(entry => {
        console.log('SUCCESS', formatEntryLabel(entry));
      });
      failedEntries.forEach(entry => {
        console.log('FAILED', formatEntryLabel(entry));
      });
      console.log(`Skipped entries: ${skippedCount}`);
      if (cancelledCount > 0) {
        console.log(`Cancelled entries: ${cancelledCount}`);
      }
    }
  } catch (error) {
    syncResultCounts();
    await ensureScreenshot();
    logPhase(
      'fatal',
      `Reservation flow failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    syncResultCounts();
    await ensureScreenshot();
    await browser?.close();
    await persistLogFile(successEntries, failedEntries, skippedCount, cancelledCount);
    try {
      await sendLineNotification(
        `${process.env.PLAYWRIGHT_GROUP_ID}/${process.env.SERVICE_USER}: 成功${successEntries.length}件 失敗${failedEntries.length}件 スキップ${skippedCount}件 キャンセル${cancelledCount}件`,
      );
    } catch {
      // LINE通知失敗は本処理結果を失敗扱いにしない
    }
  }
}

function formatSuccessSummary(entry: RepresentativeEntry): string {
  const gym = entry.gymName || '施設未指定';
  const room = entry.room || '部屋未指定';
  const date = entry.date || '日付未指定';
  const time = entry.time || '時間未指定';
  return `${date} ${time}に${gym}の${room}を予約しました。`;
}

async function persistLogFile(
  successEntries: RepresentativeEntry[],
  failedEntries: RepresentativeEntry[],
  skippedCount: number,
  cancelledCount: number,
): Promise<void> {
  const summaryLine = `成功${successEntries.length}件 失敗${failedEntries.length}件 スキップ${skippedCount}件 キャンセル${cancelledCount}件`;
  const detailLines = failedEntries.length > 0
    ? failedEntries.map(entry => `失敗: ${formatEntryLabel(entry)}`)
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
