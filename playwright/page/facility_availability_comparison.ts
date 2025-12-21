import type { Locator, Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { deriveUdParam, throwLoggedError, waitForTutorial } from '../util';

const COMPARISON_URL_PREFIX = 'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison';
const COMPARISON_TABLE_ROWS = 'table.AvailabilityFrames_gridTable tr';

export async function runFacilityAvailabilityComparisonPage(page: Page, entry: RepresentativeEntry): Promise<void> {
  await page.waitForURL(url => url.toString().startsWith(COMPARISON_URL_PREFIX), {
    timeout: 10_000,
  });

  await waitForTutorial(page);
  await page.locator('table.AvailabilityFrames_gridTable').first().waitFor({ state: 'visible', timeout: 10_000 });

  const parts = splitRoomAndBooth(entry.room);
  const desiredDateIso = deriveUdParam(entry.date);
  if (!desiredDateIso) {
    throwLoggedError(`[runFacilityAvailabilityComparisonPage] 予約日付形式が不正です: ${entry.date}`);
  }

  const normalizedBooth = normalizeText(parts.booth);
  const boothRow = await findBoothRow(page, normalizedBooth);
  await boothRow.scrollIntoViewIfNeeded().catch(() => undefined);
  await boothRow.waitFor({ state: 'visible', timeout: 5_000 });

  await clickAvailableComparisonSlot(boothRow, desiredDateIso);
}

type RoomParts = { booth?: string };

function splitRoomAndBooth(room: string): RoomParts {
  const segments = room
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  if (segments.length === 0) {
    return { booth: undefined };
  }

  if (segments.length === 1) {
    return { booth: undefined };
  }

  const booth = segments.pop();
  return {
    booth,
  };
}

async function findBoothRow(page: Page, normalizedBoothName: string): Promise<Locator> {
  if (normalizedBoothName === '' || normalizedBoothName === '全面') {
    return page.locator(COMPARISON_TABLE_ROWS).nth(3);
  }
  const rows = page.locator(COMPARISON_TABLE_ROWS);
  // const fallbackCount = await rows.count();
  // if (fallbackCount === 3) {
  //   return rows.nth(2);
  // }

  const labels: string[] = await rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const el = tr.querySelector<HTMLElement>(
        'th.AvailabilityFrames_gridTable_tbody_rowTitle .v-btn__content'
      );
      return (el?.textContent ?? '').trim();
    })
  );

  let fallbackIndex: number | undefined;

  for (let i = 0; i < labels.length; i += 1) {
    const normalizedLabel = normalizeComparisonLabel(labels[i]);
    if (!normalizedLabel) continue;

    if (normalizedLabel === normalizedBoothName) return rows.nth(i);
    if (fallbackIndex === undefined && normalizedLabel.includes(normalizedBoothName)) fallbackIndex = i;
  }

  if (fallbackIndex !== undefined) return rows.nth(fallbackIndex);

  throwLoggedError(
    `[runFacilityAvailabilityComparisonPage] ブース "${normalizedBoothName}" に一致する行が見つかりませんでした。`
  );
}


function normalizeText(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, '').trim();
}

function normalizeComparisonLabel(value?: string | null): string {
  if (!value) {
    return '';
  }
  const normalized = value
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[()]/g, '');
  return normalizeText(normalized);
}

async function clickAvailableComparisonSlot(row: Locator, desiredDateIso: string): Promise<void> {
  const links = row.locator('a.AvailabilityFrames_dayFrame_content');
  const linkCount = await links.count();
  for (let i = 0; i < linkCount; i += 1) {
    const link = links.nth(i);
    const title = await link.getAttribute('title');
    if (!title || !title.includes('抽選申込可')) {
      continue;
    }

    const slotDate = await resolveSlotDate(link);
    if (slotDate !== desiredDateIso) {
      continue;
    }

    await ensureLinkVisible(link);
    await link.click();
    return;
  }

  throwLoggedError('[runFacilityAvailabilityComparisonPage] 希望する日付の抽選枠を比較ページで見つけられませんでした。');
}


async function ensureLinkVisible(link: Locator): Promise<void> {
  await link.evaluate(element => {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

    let parent = element.parentElement;
    while (parent) {
      if (parent instanceof HTMLElement && parent.scrollWidth > parent.clientWidth + 5) {
        const elementRect = element.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const horizontalDelta = (elementRect.left - parentRect.left) - (parent.clientWidth / 2) + (elementRect.width / 2);
        parent.scrollLeft += horizontalDelta;
        const verticalDelta = (elementRect.top - parentRect.top) - (parent.clientHeight / 2) + (elementRect.height / 2);
        parent.scrollTop += verticalDelta;
        break;
      }
      parent = parent.parentElement;
    }
  });
}

async function resolveSlotDate(link: Locator): Promise<string | undefined> {
  const timeElement = link.locator('time').first();
  const datetime = await timeElement.getAttribute('datetime').catch(() => undefined);
  if (datetime) {
    return datetime.split(' ')[0];
  }

  const href = await link.getAttribute('href');
  if (!href) {
    return undefined;
  }

  try {
    const url = new URL(href, 'https://yoyaku.harp.lg.jp');
    const dateParam = url.searchParams.get('d');
    return dateParam ?? undefined;
  } catch {
    return undefined;
  }
}
