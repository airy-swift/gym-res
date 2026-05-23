import type { Page } from '@playwright/test';
import { captureScreenshot, logEarlyReturn } from '../util';
import type { RepresentativeEntry } from '../types';
import { getNextMonthYearMonth } from '../entry_utils';

export const REQUEST_STATUS_URL =
  'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/';
export const REQUEST_STATUS_INDEX_URL = `${REQUEST_STATUS_URL}Index?t=0&p=1&s=20`;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const JST_TIMEZONE = 'Asia/Tokyo';
const ACCOUNT_NAME_CANDIDATES: { selector: string; allowPlainText: boolean }[] = [
  { selector: 'div.SideNav_pocket div.mb-2', allowPlainText: false },
  { selector: 'div.SideNav_pocket span.font-weight-bold:nth-of-type(2)', allowPlainText: true },
  { selector: 'div.SideNav_pocket span.font-weight-bold', allowPlainText: true },
  { selector: 'div.SideNav_pocket', allowPlainText: false },
];
const ACCOUNT_NAME_BLOCKLIST = new Set([
  'メニュー',
  'ホーム',
  '施設一覧・検索',
  'お知らせ',
  '申込状況',
  'お気に入り',
  'メッセージ',
  'アカウント設定',
  'ログアウト',
  'ヘルプ',
  'サイトマップ',
  '規約と方針',
  'お問い合わせ',
  '特定商取引法に基づく表示',
  '閉じる',
]);
const REQUEST_STATUS_URL_WITHOUT_TRAILING_SLASH = REQUEST_STATUS_URL.replace(/\/$/, '');

export type RequestStatusFilter = {
  ja: string;
  icon: string;
  needScreenshot: boolean;
};

export type RequestStatusPageOptions = {
  targetYearMonth?: string;
  captureScreenshots?: boolean;
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

function normalizeAccountName(value: string): string {
  return value
    .replace(/ログイン中/g, '')
    .replace(/さん/g, '')
    .replace(/[：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickAccountNameFromText(source: string, allowPlainText = false): string {
  const normalized = source.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const loginMatch = normalized.match(/ログイン中\s*([^\s]+(?:\s+[^\s]+)*)\s*さん?/);
  if (loginMatch?.[1]) {
    return normalizeAccountName(loginMatch[1] ?? '');
  }

  const honorificMatch = normalized.match(/([^\s]+(?:\s+[^\s]+)*)\s*さん/);
  if (honorificMatch?.[1]) {
    return normalizeAccountName(honorificMatch[1] ?? '');
  }

  if (!allowPlainText) {
    return '';
  }

  const plainName = normalizeAccountName(normalized);
  if (!plainName || ACCOUNT_NAME_BLOCKLIST.has(plainName)) {
    return '';
  }
  return plainName;
}

async function resolveAccountName(page: Page): Promise<string> {
  for (const candidate of ACCOUNT_NAME_CANDIDATES) {
    const locator = page.locator(candidate.selector);
    const count = await locator.count();
    if (count === 0) {
      continue;
    }

    for (let index = 0; index < count; index += 1) {
      const text = normalizeSpaces(await locator.nth(index).innerText());
      const accountName = pickAccountNameFromText(text, candidate.allowPlainText);
      if (accountName) {
        return accountName;
      }
    }
  }

  try {
    const bodyText = await page.locator('body').innerText();
    const accountName = pickAccountNameFromText(bodyText);
    if (accountName) {
      return accountName;
    }
  } catch {
    // ignore
  }

  return '';
}

function resolveAccountId(): string {
  return (process.env.SERVICE_USER ?? '').trim();
}

export async function ensureRequestStatusPage(
  page: Page,
  filter: RequestStatusFilter,
  screenshotPaths?: string[],
  options: RequestStatusPageOptions = {},
): Promise<RepresentativeEntry[]> {
  if (!isRequestStatusUrl(page.url())) {
    await page.goto(REQUEST_STATUS_INDEX_URL, { waitUntil: 'domcontentloaded' });
  } else {
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {
      logEarlyReturn('Request status page did not reach domcontentloaded within 5000ms; continuing with current DOM.');
    });
  }
  await page.getByRole('button', { name: /申込状態：/ }).click();
  await page.getByRole('button', { name: filter.ja, exact: true }).click();
  await new Promise(resolve => setTimeout(resolve, 3_000));
  const accountName = await resolveAccountName(page);
  const accountId = resolveAccountId();

  if (filter.needScreenshot && options.captureScreenshots !== false) {
    try {
      const screenshotPath = await captureScreenshot(page, 'request-status-page');
      screenshotPaths?.push(screenshotPath);
    } catch (error) {
      logEarlyReturn(
        `Failed to capture request status screenshot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
  const targetMonthCursor = resolveTargetMonth(options.targetYearMonth);

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

    const matchesTargetMonth =
      startDate.getFullYear() === targetMonthCursor.year && startDate.getMonth() === targetMonthCursor.monthIndex;
    if (!matchesTargetMonth) {
      logEarlyReturn(`Skipping entry that is not for target month: ${targetMonthCursor.label}`);
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
      // 保存フォーマットは [date, time, gymName, room, accountName, accountId] のため、ここでは
      // gymName=room, room=booth の順に詰める。
      gymName: parsedLocation.room,
      room: parsedLocation.booth,
      date: dateLabel,
      time: timeRange,
      accountName,
      accountId,
    });
  }
  return results;
}

function isRequestStatusUrl(url: string): boolean {
  return url === REQUEST_STATUS_URL_WITHOUT_TRAILING_SLASH || url.startsWith(REQUEST_STATUS_URL);
}

function resolveTargetMonth(targetYearMonth?: string): { year: number; monthIndex: number; label: string } {
  const resolvedTargetMonth = parseTargetMonth(targetYearMonth);
  if (resolvedTargetMonth) {
    return resolvedTargetMonth;
  }

  const defaultTargetMonth = parseTargetMonth(getNextMonthYearMonth(JST_TIMEZONE));
  if (defaultTargetMonth) {
    return defaultTargetMonth;
  }

  throw new Error('Failed to resolve request status target month.');
}

function parseTargetMonth(targetYearMonth?: string): { year: number; monthIndex: number; label: string } | null {
  const match = targetYearMonth?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
      return {
        year,
        monthIndex: month - 1,
        label: `${year}-${String(month).padStart(2, '0')}`,
      };
    }
  }

  return null;
}
