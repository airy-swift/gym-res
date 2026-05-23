import type { Locator, Page } from '@playwright/test';

import type { RepresentativeEntry } from '../types';
import { runSeekLotPage } from './seek_lot_page';
import { logEarlyReturn, throwLoggedError, waitForTutorial } from '../util';
import {
  compareEntriesForStableOrder,
  entriesConflictWithExistingRequest,
  entryMatchesSeekFilter,
  formatJapaneseDateFromIso,
  getNextMonthYearMonth,
  normalizeDateToIso,
  normalizeSeekLotFilter,
  type NormalizedSeekLotFilter,
  type SeekLotFilter,
} from '../entry_utils';

const GYM_URLS = [
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011002&tg%5B0%5D.fc=0004&tg%5B0%5D.r%5B0%5D=001&tg%5B1%5D.lg=011002&tg%5B1%5D.fc=0040&tg%5B1%5D.r%5B0%5D=002&tg%5B1%5D.r%5B1%5D=001&tg%5B2%5D.lg=011002&tg%5B2%5D.fc=0005&tg%5B2%5D.r%5B0%5D=001&tg%5B3%5D.lg=011002&tg%5B3%5D.fc=0010&tg%5B3%5D.r%5B0%5D=001&tg%5B3%5D.r%5B1%5D=002&tg%5B4%5D.lg=011002&tg%5B4%5D.fc=0020&tg%5B4%5D.r%5B0%5D=001&tg%5B4%5D.r%5B1%5D=002&tg%5B5%5D.lg=011002&tg%5B5%5D.fc=0030&tg%5B5%5D.r%5B0%5D=001&tg%5B5%5D.r%5B1%5D=002&d='
];
const SCHOOL_URLS = [
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011002&tg%5B0%5D.fc=0202&tg%5B0%5D.r%5B0%5D=050&tg%5B1%5D.lg=011002&tg%5B1%5D.fc=0214&tg%5B1%5D.r%5B0%5D=050&tg%5B2%5D.lg=011002&tg%5B2%5D.fc=0217&tg%5B2%5D.r%5B0%5D=050&tg%5B3%5D.lg=011002&tg%5B3%5D.fc=0230&tg%5B3%5D.r%5B0%5D=050&tg%5B4%5D.lg=011002&tg%5B4%5D.fc=0231&tg%5B4%5D.r%5B0%5D=050&tg%5B5%5D.lg=011002&tg%5B5%5D.fc=0242&tg%5B5%5D.r%5B0%5D=050&tg%5B6%5D.lg=011002&tg%5B6%5D.fc=0285&tg%5B6%5D.r%5B0%5D=050&tg%5B7%5D.lg=011002&tg%5B7%5D.fc=0292&tg%5B7%5D.r%5B0%5D=050&tg%5B8%5D.lg=011002&tg%5B8%5D.fc=0302&tg%5B8%5D.r%5B0%5D=050&tg%5B9%5D.lg=011002&tg%5B9%5D.fc=0305&tg%5B9%5D.r%5B0%5D=050&d=',
  'https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison?tg%5B0%5D.lg=011002&tg%5B0%5D.fc=0337&tg%5B0%5D.r%5B0%5D=050&tg%5B1%5D.lg=011002&tg%5B1%5D.fc=0338&tg%5B1%5D.r%5B0%5D=050&tg%5B2%5D.lg=011002&tg%5B2%5D.fc=0340&tg%5B2%5D.r%5B0%5D=050&tg%5B3%5D.lg=011002&tg%5B3%5D.fc=0341&tg%5B3%5D.r%5B0%5D=050&tg%5B4%5D.lg=011002&tg%5B4%5D.fc=0342&tg%5B4%5D.r%5B0%5D=050&tg%5B5%5D.lg=011002&tg%5B5%5D.fc=0344&tg%5B5%5D.r%5B0%5D=050&tg%5B6%5D.lg=011002&tg%5B6%5D.fc=0361&tg%5B6%5D.r%5B0%5D=050&tg%5B7%5D.lg=011002&tg%5B7%5D.fc=0366&tg%5B7%5D.r%5B0%5D=050&tg%5B8%5D.lg=011002&tg%5B8%5D.fc=0391&tg%5B8%5D.r%5B0%5D=050&d='
];

const JST_TIMEZONE = 'Asia/Tokyo';
const DETAIL_PAGE_CONCURRENCY = 10;

type SeekLotCandidate = { count: number; entry: RepresentativeEntry };

export type SeekLotCompareOptions = {
  filter?: SeekLotFilter;
  blockedEntries?: RepresentativeEntry[];
  excludedEntries?: RepresentativeEntry[];
};

export async function runSeekLotComparePage(
  page: Page,
  desiredCount: number,
  options: SeekLotCompareOptions = {},
): Promise<RepresentativeEntry[]> {
  if (desiredCount <= 0) {
    return [];
  }

  const normalizedFilter = resolveNormalizedFilter(options.filter);
  const blockedEntries = options.blockedEntries ?? [];
  const excludedEntries = options.excludedEntries ?? [];
  const candidates: SeekLotCandidate[] = [];
  const now = new Date();
  const jstTimestamp = new Date(now.toLocaleString('en-US', { timeZone: JST_TIMEZONE }));
  const searchMonth = normalizedFilter.dateIso
    ? normalizedFilter.dateIso.slice(0, 7)
    : getNextMonthYearMonth(JST_TIMEZONE);
  const isFirstHalf = jstTimestamp.getDate() <= 15;
  const chosenUrlBase = isFirstHalf ? GYM_URLS : SCHOOL_URLS;
  const selectedUrls = searchMonth
    ? chosenUrlBase.map(url => `${url}${searchMonth}`)
    : chosenUrlBase;

  if (normalizedFilter.dateIso || normalizedFilter.timeRange) {
    console.log(
      `🔎 条件付き探索: 日付=${normalizedFilter.dateIso ?? '指定なし'} 時間=${normalizedFilter.timeRange?.label ?? '指定なし'}`,
    );
  }

  for (const url of selectedUrls) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.toString().startsWith('https://yoyaku.harp.lg.jp/sapporo/FacilityAvailability/Comparison'), {
      timeout: 10_000,
    });

    await waitForTutorial(page);

    const firstLotteryLink = page.locator('a.AvailabilityFrames_dayFrame_content.is-lot').first();
    const hasLotteryLinks = await firstLotteryLink
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasLotteryLinks) {
      logEarlyReturn(`[runSeekLotComparePage] 抽選枠リンクが見つかりませんでした: ${url}`);
      continue;
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const lotteryLinks = page.locator('a.AvailabilityFrames_dayFrame_content.is-lot');
    const count = await lotteryLinks.count();
    const targetUrls: string[] = [];
    
    for (let j = 0; j < count; j++) {
      const lotteryLink = lotteryLinks.nth(j);
      const href = await lotteryLink.getAttribute('href');
      if (!href) {
        continue;
      }
      if (normalizedFilter.dateIso) {
        const linkDate = await resolveComparisonLinkDate(lotteryLink);
        if (linkDate && linkDate !== normalizedFilter.dateIso) {
          continue;
        }
      }
      targetUrls.push(buildAbsoluteUrl(href));
    }

    // bot判定をお気持ちで避けたいのでシャッフルしてせめてもの抵抗をする
    shuffleInPlace(targetUrls);

    const targetCount = targetUrls.length;
    if (targetCount === 0) {
      continue;
    }

    console.log(`🔍 詳細チェック開始 ${formatCurrentJst()} 件数:${targetCount}`);
    let processedCount = 0;

    shuffleInPlace(targetUrls);

    await processWithConcurrency(targetUrls, DETAIL_PAGE_CONCURRENCY, async targetUrl => {
      const detailPage = await page.context().newPage();
      try {
        await detailPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        const seekLots = await runSeekLotPage(detailPage, targetUrl, normalizedFilter);
        if (seekLots?.length) {
          seekLots
            .filter(({ entry }) => entryMatchesSeekFilter(entry, normalizedFilter))
            .forEach(candidate => {
              if (isBlockedEntry(candidate.entry, blockedEntries) || isExcludedEntry(candidate.entry, excludedEntries)) {
                logRejected(candidate.entry, candidate.count);
                return;
              }
              candidates.push(candidate);
            });
        }
      } catch (error) {
        logEarlyReturn(
          `[runSeekLotComparePage] 詳細ページの探索に失敗したため見送ります: ${targetUrl} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await detailPage.close();
      }

      processedCount += 1;
      if (processedCount % 50 === 0) {
        console.log(`  残り${Math.max(targetCount - processedCount, 0)}件`);
      }
    });

    console.log(`✅ 詳細チェック完了 ${formatCurrentJst()} 件数:${targetCount}`);
  }

  const selectedCandidates = selectBestCandidates(candidates, desiredCount);
  selectedCandidates.forEach(({ count, entry }) => logAdopted(entry, count));
  
  return selectedCandidates
    .map(({ entry }) => ({
      ...entry,
      date: formatJapaneseDateFromIso(entry.date),
    }));
}

function resolveNormalizedFilter(filter?: SeekLotFilter): NormalizedSeekLotFilter {
  const normalizedFilter = normalizeSeekLotFilter(filter);
  if (!normalizedFilter) {
    throwLoggedError(
      `[runSeekLotComparePage] 探索条件の日付または時間形式が不正です: date=${filter?.date ?? ''} time=${filter?.time ?? ''}`,
    );
  }
  return normalizedFilter;
}

function buildAbsoluteUrl(href: string): string {
  try {
    return new URL(href, 'https://yoyaku.harp.lg.jp').toString();
  } catch (error) {
    console.warn('Failed to build absolute URL for lot link', href, error);
    return 'https://yoyaku.harp.lg.jp';
  }
}

function formatCurrentJst(): string {
  return new Date().toLocaleString('ja-JP', { timeZone: JST_TIMEZONE });
}

function formatEntryLog(entry: RepresentativeEntry, count: number): string {
  return `応募数:${count} 施設:${entry.gymName} 部屋:${entry.room} 日付:${entry.date} 時間:${entry.time}`;
}

function logAdopted(entry: RepresentativeEntry, count: number): void {
  console.log(`🎉 採用 ${formatEntryLog(entry, count)}`);
}

function logRejected(entry: RepresentativeEntry, count: number): void {
  console.log(`  見送り ${formatEntryLog(entry, count)}`);
}

function isBlockedEntry(entry: RepresentativeEntry, blockedEntries: RepresentativeEntry[]): boolean {
  return blockedEntries.some(blockedEntry => entriesConflictWithExistingRequest(blockedEntry, entry));
}

function isExcludedEntry(entry: RepresentativeEntry, excludedEntries: RepresentativeEntry[]): boolean {
  return excludedEntries.some(excludedEntry => entriesConflictWithExistingRequest(excludedEntry, entry));
}

function selectBestCandidates(candidates: SeekLotCandidate[], desiredCount: number): SeekLotCandidate[] {
  const selected: SeekLotCandidate[] = [];
  const sortedCandidates = candidates
    .filter(candidate => Number.isFinite(candidate.count))
    .sort(compareCandidates);

  for (const candidate of sortedCandidates) {
    const alreadySelected = selected.some(selectedCandidate => entriesConflictWithExistingRequest(selectedCandidate.entry, candidate.entry));
    if (alreadySelected) {
      logRejected(candidate.entry, candidate.count);
      continue;
    }

    selected.push(candidate);
    if (selected.length >= desiredCount) {
      break;
    }
  }

  return selected;
}

function compareCandidates(lhs: SeekLotCandidate, rhs: SeekLotCandidate): number {
  const countDiff = lhs.count - rhs.count;
  if (countDiff !== 0) {
    return countDiff;
  }
  return compareEntriesForStableOrder(lhs.entry, rhs.entry);
}

async function resolveComparisonLinkDate(link: Locator): Promise<string | undefined> {
  const datetime = await link
    .locator('time')
    .first()
    .getAttribute('datetime')
    .catch(() => null);
  if (datetime) {
    return normalizeDateToIso(datetime.split(' ')[0]) ?? undefined;
  }

  const href = await link.getAttribute('href');
  if (!href) {
    return undefined;
  }

  try {
    const url = new URL(href, 'https://yoyaku.harp.lg.jp');
    const dateParam = url.searchParams.get('d') ?? url.searchParams.get('ud');
    return normalizeDateToIso(dateParam) ?? undefined;
  } catch {
    return undefined;
  }
}

async function processWithConcurrency<T>(items: T[], limit: number, handler: (item: T, index: number) => Promise<void>): Promise<void> {
  if (items.length === 0 || limit <= 0) {
    return;
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await handler(items[index], index);
    }
  });
  await Promise.all(workers);
}

function shuffleInPlace<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
