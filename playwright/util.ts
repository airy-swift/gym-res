import type { Page } from '@playwright/test';
import https from 'node:https';

import type { Job, RepresentativeEntry } from './types';

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
  const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (!groupId) {
    logEarlyReturn('PLAYWRIGHT_GROUP_ID is not set; skipping representative entry fetch.');
    return [];
  }

  if (!apiBaseUrl) {
    logEarlyReturn('API_BASE_URL is not set; skipping API fetch.');
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

export async function fetchJob(): Promise<Job | null> {
  const jobId = process.env.JOB_ID;
  const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const apiToken = process.env.API_TOKEN;

  if (!jobId) {
    logEarlyReturn('JOB_ID is not set; skipping job fetch.');
    return null;
  }

  if (!apiBaseUrl || !apiToken) {
    logEarlyReturn('API_BASE_URL or API_TOKEN missing; skipping job fetch.');
    return null;
  }

  try {
    const endpoint = `${apiBaseUrl.replace(/\/?$/, '')}/api/jobs?jobId=${jobId}`;
    const response = await fetch(endpoint, {
      headers: {
        API_TOKEN: apiToken,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      logEarlyReturn(`Failed to fetch job (status ${response.status}): ${text}`);
      return null;
    }

    const payload = (await response.json()) as Partial<Job>;
    const entryCount = typeof payload.entryCount === 'number' ? payload.entryCount : undefined;

    return {
      jobId,
      entryCount,
    } satisfies Job;
  } catch (error) {
    logEarlyReturn(`Failed to fetch job: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function updateJobProgress(progress: string): Promise<void> {
  const jobId = process.env.JOB_ID;
  const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const apiToken = process.env.API_TOKEN;

  if (!jobId) {
    logEarlyReturn('JOB_ID is not set; skipping progress update.');
    return;
  }

  if (!apiBaseUrl || !apiToken) {
    logEarlyReturn('API_BASE_URL or API_TOKEN missing; skipping progress update.');
    return;
  }

  try {
    const endpoint = `${apiBaseUrl.replace(/\/?$/, '')}/api/jobs/progress`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        API_TOKEN: apiToken,
      },
      body: JSON.stringify({ jobId, progress }),
    });

    if (!response.ok) {
      const text = await response.text();
      logEarlyReturn(`Failed to update job progress (status ${response.status}): ${text}`);
    }
  } catch (error) {
    logEarlyReturn(`Failed to update job progress: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function cleanupJobCredentials(): Promise<void> {
  const jobId = process.env.JOB_ID;
  const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const apiToken = process.env.API_TOKEN;

  if (!jobId) {
    logEarlyReturn('JOB_ID is not set; skipping job cleanup.');
    return;
  }

  if (!apiBaseUrl || !apiToken) {
    logEarlyReturn('API_BASE_URL or API_TOKEN missing; skipping job cleanup.');
    return;
  }

  try {
    const endpoint = `${apiBaseUrl.replace(/\/?$/, '')}/api/jobs/cleanup`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        API_TOKEN: apiToken,
      },
      body: JSON.stringify({ jobId }),
    });

    if (!response.ok) {
      const text = await response.text();
      logEarlyReturn(`Failed to cleanup job credentials (status ${response.status}): ${text}`);
    }
  } catch (error) {
    logEarlyReturn(`Failed to cleanup job credentials: ${error instanceof Error ? error.message : String(error)}`);
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

export async function waitForTutorial(page: Page): Promise<void> {
  await page.waitForSelector('#fixedCotnentsWrapper', { state: 'hidden' });
  const skipButton = page.getByText('スキップ');
  let found = false;
  await skipButton.first()
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => { found = true; })
    .catch(() => { /* 出なかっただけ */ });
  if (found) {
    await skipButton.first().click();
  }
  await page.waitForSelector('#fixedCotnentsWrapper', { state: 'hidden' });
}

export const sendLineNotification = async (text: string): Promise<void> => {
  const accessToken = process.env.LINE_ACCESS_TOKEN;
  if (!accessToken) {
    logEarlyReturn('LINE_ACCESS_TOKEN is not set; skipping LINE notification.');
    return;
  }

  const options = {
    hostname: 'api.line.me',
    path: '/v2/bot/message/push',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  } satisfies https.RequestOptions;

  const body = JSON.stringify({
    to: 'Ua90a4bb44681d318279eab45d9269b87',
    messages: [
      {
        type: 'text',
        text,
      },
    ],
  });

  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt < 10) {
    attempt += 1;
    try {
      await postJson(options, body);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= 10) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (lastError) {
    throw lastError;
  }
};

function postJson(options: https.RequestOptions, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.request(options, response => {
      const chunks: Array<Buffer> = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error(`LINE push failed (${response.statusCode ?? 'unknown'}): ${responseText}`));
      });
    });

    request.on('error', error => {
      reject(error);
    });

    request.write(payload);
    request.end();
  });
}
