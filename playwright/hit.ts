import { pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

import { cleanupJobCredentials, logEarlyReturn, saveApplicationHits, uploadApplicationImage } from './util';
import { loadEnv } from './env';
import { runLoginPage } from './page/login_page';
import type { RepresentativeEntry } from './types';
import { ensureRequestStatusPage, REQUEST_STATUS_FILTERS } from './page/request_status_page';

export const HEADLESS = false;
export const HIT_STATUS_URL = 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20';
const REQUEST_STATUS_SCREENSHOT_PREFIX = 'request-status-page';

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

    const screenshotPaths: string[] = [];
    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const hits = await ensureRequestStatusPage(page, REQUEST_STATUS_FILTERS[0], screenshotPaths);
    await page.goto('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index?t=0&p=1&s=20', { waitUntil: 'domcontentloaded' });
    const fixed = await ensureRequestStatusPage(page, REQUEST_STATUS_FILTERS[2], screenshotPaths);

    const timestamp = Date.now().toString();
    const applicationId = buildApplicationId(timestamp);
    await persistHitSummary(hits, fixed, timestamp, applicationId);
    await uploadRequestStatusScreenshots(screenshotPaths, timestamp, applicationId);
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

async function persistHitSummary(
  hits: RepresentativeEntry[],
  fixed: RepresentativeEntry[],
  timestamp: string,
  applicationId: string,
): Promise<void> {
  const groupId = (process.env.PLAYWRIGHT_GROUP_ID ?? process.env.GROUP_ID ?? '').trim();
  if (!groupId) {
    logEarlyReturn('PLAYWRIGHT_GROUP_ID is not set; skipping hit summary save.');
    return;
  }

  const lines = buildStandardizedHitLines(hits, fixed);
  const saved = await saveApplicationHits({ groupId, timestamp, applicationId, hits: lines });
  logEarlyReturn(`Saved standardized hit lines: ${saved ? lines.length : 0}/${lines.length}`);
}

async function uploadRequestStatusScreenshots(
  screenshotPaths: string[],
  timestamp: string,
  applicationId: string,
): Promise<void> {
  const groupId = (process.env.PLAYWRIGHT_GROUP_ID ?? process.env.GROUP_ID ?? '').trim();
  if (!groupId) {
    logEarlyReturn('PLAYWRIGHT_GROUP_ID is not set; skipping request-status screenshot upload.');
    return;
  }

  const requestStatusPaths = Array.from(
    new Set(
      screenshotPaths.filter(filePath => path.basename(filePath).startsWith(REQUEST_STATUS_SCREENSHOT_PREFIX)),
    ),
  );
  if (requestStatusPaths.length === 0) {
    logEarlyReturn('No request-status screenshots to upload.');
    return;
  }

  const runSuffix = Math.random().toString(36).slice(2, 10);
  let uploadedCount = 0;

  for (const localImagePath of requestStatusPaths) {
    try {
      const absolutePath = path.resolve(process.cwd(), localImagePath);
      const imageData = await fs.readFile(absolutePath);
      const fileName = `${runSuffix}-${path.basename(localImagePath)}`;
      const uploaded = await uploadApplicationImage({
        groupId,
        timestamp,
        applicationId,
        fileName,
        imageData,
        contentType: 'image/jpeg',
      });
      if (uploaded) {
        uploadedCount += 1;
      }
    } catch (error) {
      logEarlyReturn(
        `Failed to prepare screenshot upload (${localImagePath}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  logEarlyReturn(`Uploaded request-status screenshots: ${uploadedCount}/${requestStatusPaths.length}`);
}

function buildApplicationId(timestamp: string): string {
  const rowIndex = (process.env.PLAYWRIGHT_ROW_INDEX ?? '').trim();
  if (/^\d+$/.test(rowIndex)) {
    return `${timestamp}-${rowIndex}`;
  }
  return timestamp;
}

function buildStandardizedHitLines(hits: RepresentativeEntry[], fixed: RepresentativeEntry[]): string[] {
  return Array.from(new Set([...hits, ...fixed].map(entry => formatHitLine(entry))));
}

function formatHitLine(entry: RepresentativeEntry): string {
  const normalize = (value?: string) => (value ?? '').replace(/\s+/g, ' ').trim() || '-';
  const normalizeDate = (value?: string) => {
    const normalized = normalize(value);
    const match = normalized.match(/(?:\d{4}年)?\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (!match) {
      return normalized;
    }
    return `${Number(match[1])}月${Number(match[2])}日`;
  };
  const normalizeTime = (value?: string) => {
    const normalized = normalize(value);
    return normalized.replace(/(^|[^0-9])(\d{1,2}):([0-5]\d)(?=[^0-9]|$)/g, (_, prefix: string, hour: string, minute: string) => {
      return `${prefix}${Number(hour)}:${minute}`;
    });
  };
  return [
    normalizeDate(entry.date),
    normalizeTime(entry.time),
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
