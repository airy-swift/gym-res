import type { Page } from '@playwright/test';
import { captureScreenshot, logEarlyReturn } from '../util';
import type { RepresentativeEntry } from '../types';

const REQUEST_STATUS_URL =
  'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export type RequestStatusFilter = {
  ja: string;
  icon: string;
  needScreenshot: boolean;
};

export const REQUEST_STATUS_FILTERS: RequestStatusFilter[] = [
  { ja: '当選', icon: 'lottery', needScreenshot: true },
  { ja: '抽選待ち', icon: 'lottery_wait', needScreenshot: false },
  { ja: '当選確定', icon: 'lottery_resolved', needScreenshot: true },
];

function parseRoomAndBooth(linkTextRaw: string): { room: string; booth: string } {
  const locationSource = extractLocationSource(linkTextRaw);
  const { facility, booth } = splitFacilityAndBooth(locationSource);
  return {
    room: facility,
    booth,
  };
}

function extractLocationSource(value: string): string {
  const normalized = normalizeSpaces(value);
  const locationMatch = normalized.match(/場所[:：]\s*(.+)$/);
  if (locationMatch?.[1]) {
    return normalizeSpaces(locationMatch[1]);
  }

  const parts = normalized.split('/').map(normalizeSpaces).filter(Boolean);
  if (parts.length >= 2) {
    const [first, ...rest] = parts;
    if (isApplicationIdLike(first)) {
      return rest.join(' / ');
    }
  }

  return normalized;
}

function splitFacilityAndBooth(locationSource: string): { facility: string; booth: string } {
  const parts = locationSource.split('/').map(normalizeSpaces).filter(Boolean);
  if (parts.length >= 2) {
    const [facility, ...rest] = parts;
    return {
      facility,
      booth: rest.join(' / '),
    };
  }

  const tokens = locationSource.split(' ').filter(Boolean);
  if (tokens.length >= 2) {
    const boothCandidate = tokens[tokens.length - 1] ?? '';
    if (isBoothLike(boothCandidate)) {
      return {
        facility: tokens.slice(0, -1).join(' '),
        booth: boothCandidate,
      };
    }
  }

  return { facility: locationSource, booth: '' };
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isApplicationIdLike(value: string): boolean {
  return /^\d{8,}-\d+$/.test(value);
}

function isBoothLike(value: string): boolean {
  return /(体育館|グラウンド|コート|ホール|スタジオ|プール|武道場|会議室|講堂|全面|半面|面)$/.test(value);
}

function toDate(source: string | null): Date | null {
  if (!source) return null;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateLabel(dateValue: Date | null): string {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const weekday = WEEKDAYS[date.getDay()] ?? '';
  return `${year}年${month}月${day}日(${weekday})`;
}

export async function ensureRequestStatusPage(
  page: Page,
  filter: RequestStatusFilter,
  screenshotPaths?: string[],
): Promise<RepresentativeEntry[]> {
  if (!page.url().startsWith(REQUEST_STATUS_URL)) {
    await page.waitForURL(url => url.toString().startsWith(REQUEST_STATUS_URL), {
      timeout: 10_000,
      waitUntil: 'domcontentloaded',
    });
  } else {
    await page.waitForLoadState('domcontentloaded');
  }
  await page.getByRole('button', { name: /申込状態：\s*すべての状態/ }).click();
  await page.getByRole('button', { name: filter.ja, exact: true }).click();
  await new Promise(resolve => setTimeout(resolve, 3_000));

  if (filter.needScreenshot) {
    const screenshotPath = await captureScreenshot(page, 'request-status-page');
    screenshotPaths?.push(screenshotPath);
  }
  
  await page.waitForSelector('#fixedCotnentsWrapper', { state: 'hidden' });
  const lotteryLists = page.locator('div[role="list"].v-list.is-withBorder-marginL.h-radius-s');
  if ((await lotteryLists.count()) === 0) {
    logEarlyReturn('No lottery list found on request status page.');
    return [];
  }

  const lotteryList = lotteryLists.first();
  const listItems = lotteryList.locator('div[role="listitem"].v-list-item');
  try {
    await listItems.first().waitFor({ state: 'attached', timeout: 10_000 });
  } catch {
    logEarlyReturn('Lottery list exists but contains no entries.');
    return [];
  }
  const itemsCount = await listItems.count();
  if (itemsCount === 0) {
    console.log('No cancellation items found.');
    return [];
  }

  const results: RepresentativeEntry[] = [];
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const targetYear = nextMonth.getFullYear();
  const targetMonth = nextMonth.getMonth();

  for (let index = 0; index < itemsCount; index += 1) {
    const item = listItems.nth(index);
    const linkTextRaw = (await item.locator('a').innerText()).replace(/\s+/g, ' ').trim();
    const parsedLocation = parseRoomAndBooth(linkTextRaw);

    const statusIcon = item
      .locator('span.Label.is-status i.material-icons')
      .first();
    const statusText = (await statusIcon.count())
      ? (await statusIcon.innerText()).trim()
      : '';

    if (statusText !== filter.icon) {
      continue;
    }

    const timeElements = item.locator('time');
    const startAttr = (await timeElements.nth(0).getAttribute('datetime')) ?? null;
    const startDate = toDate(startAttr);

    if (!startDate) {
      logEarlyReturn('Skipping entry without valid start date.');
      continue;
    }

    const matchesNextMonth =
      startDate.getFullYear() === targetYear && startDate.getMonth() === targetMonth;
    if (!matchesNextMonth) {
      logEarlyReturn('Skipping entry that is not for next month.');
      continue;
    }

    const dateLabel = formatDateLabel(startDate);
    const timeLocator = item.locator('span.InputContainer.InputRange.is-time.d-inline-block');
    const timeRange = (await timeLocator.count())
      ? (await timeLocator
          .first()
          .innerText())
          .replace(/\s+/g, ' ')
          .trim()
      : '';

    results.push({
      // 保存フォーマットは [date, time, gymName, room] のため、ここでは
      // gymName=room, room=booth の順に詰める。
      gymName: parsedLocation.room,
      room: parsedLocation.booth,
      date: dateLabel,
      time: timeRange,
    });
  }
  return results;
}
