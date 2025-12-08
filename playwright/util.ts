import type { Page } from '@playwright/test';

import type { RepresentativeEntry } from './types';

export async function captureScreenshot(page: Page, label: string): Promise<void> {
  await page.screenshot({ path: `${label}.png`, fullPage: true });
}

export function logEarlyReturn(message: string): void {
  console.log(`[pw] ${message}`);
}

export function throwLoggedError(message: string): never {
  logEarlyReturn(message);
  throw new Error(message);
}

export async function fetchRepresentativeEntries(): Promise<RepresentativeEntry[]> {
  const groupId = process.env.PLAYWRIGHT_GROUP_ID ?? process.env.GROUP_ID;
  const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (!groupId) {
    logEarlyReturn('PLAYWRIGHT_GROUP_ID is not set; skipping representative entry fetch.');
    return [];
  }

  if (!apiBaseUrl) {
    logEarlyReturn('PLAYWRIGHT_API_BASE_URL is not set; skipping API fetch.');
    return [];
  }

  try {
    const endpoint = `${apiBaseUrl.replace(/\/?$/, '')}/api/groups/list?groupId=${groupId}`;
    const request = await fetch(endpoint);
    if (!request.ok) {
      const text = await request.text();
      logEarlyReturn(`Failed to fetch representative entries (status ${request.status}): ${text}`);
      return [];
    }

    const data = (await request.json()) as { list?: unknown };
    const list = Array.isArray(data.list) ? data.list : [];
    return list
      .map(item => {
        const candidate = item as Partial<RepresentativeEntry>;
        return {
          gymName: typeof candidate.gymName === 'string' ? candidate.gymName : '',
          room: typeof candidate.room === 'string' ? candidate.room : '',
          date: typeof candidate.date === 'string' ? candidate.date : '',
          time: typeof candidate.time === 'string' ? candidate.time : '',
        } satisfies RepresentativeEntry;
      })
      .filter(entry => entry.gymName || entry.room || entry.date || entry.time);
  } catch (error) {
    logEarlyReturn(`Failed to fetch representative list: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function deriveUdParam(dateText: string): string | null {
  const match = dateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const formattedMonth = month.padStart(2, '0');
  const formattedDay = day.padStart(2, '0');
  return `${year}-${formattedMonth}-${formattedDay}`;
}
