import type { Page } from '@playwright/test';

import {
  buildSeekFilterForRepresentativeEntry,
  entriesAreEquivalent,
  formatEntryLabel,
  formatSeekLotFilterLabel,
  getNextMonthYearMonth,
  hasText,
  normalizeDateToIso,
  normalizeTimeRange,
  type SeekLotFilter,
} from './entry_utils';
import { ensureRequestStatusPage, REQUEST_STATUS_FILTERS, REQUEST_STATUS_INDEX_URL } from './page/request_status_page';
import { runSeekLotComparePage } from './page/seek_lot_compare_page';
import type { RepresentativeEntry } from './types';
import { logEarlyReturn, logPhase, updateJobProgress } from './util';

const JST_TIMEZONE = 'Asia/Tokyo';

type PartialEntryGroup = {
  filter: SeekLotFilter;
  entries: RepresentativeEntry[];
};

type ResolvedRepresentativeEntries = {
  entries: RepresentativeEntry[];
  unresolvedEntries: RepresentativeEntry[];
};

export type ReservationPlan = {
  entries: RepresentativeEntry[];
  failedEntries: RepresentativeEntry[];
  requestStatusEntries: RepresentativeEntry[];
  totalEntries: number;
};

export async function buildReservationPlan(
  page: Page,
  representativeEntries: RepresentativeEntry[],
  jobEntryCount: number | null,
): Promise<ReservationPlan> {
  const requestedEntries = limitRepresentativeEntries(representativeEntries, jobEntryCount);
  const requestStatusEntries = await fetchExistingRequestEntries(
    page,
    collectRequestStatusTargetMonths(requestedEntries, jobEntryCount !== null),
  );

  const resolved = await resolveRepresentativeEntries(page, requestedEntries, requestStatusEntries);
  let entries = resolved.entries;

  if (resolved.unresolvedEntries.length > 0) {
    logPhase('representative', `Representative entries unresolved before additional seek: ${resolved.unresolvedEntries.length}`);
  }

  if (jobEntryCount !== null) {
    const additionalEntryCount = Math.max(jobEntryCount - requestedEntries.length, 0);
    if (additionalEntryCount > 0) {
      logPhase('representative', `Seeking additional entries: ${additionalEntryCount}`);
      await updateJobProgress('追加分の探索中...');
      const additionalEntries = await runSeekLotComparePage(page, additionalEntryCount, {
        blockedEntries: requestStatusEntries,
        excludedEntries: entries,
      });
      entries = [...entries, ...additionalEntries];
      logPhase('representative', `Additional entries found: ${additionalEntries.length}`);
    }
  }

  const failedEntries = selectUnresolvedFailures(resolved.unresolvedEntries, entries.length, jobEntryCount);
  if (failedEntries.length > 0) {
    logPhase('representative', `Representative entries failed after additional seek: ${failedEntries.length}`);
  }

  return {
    entries,
    failedEntries,
    requestStatusEntries,
    totalEntries: jobEntryCount ?? (entries.length + failedEntries.length),
  };
}

function limitRepresentativeEntries(
  entries: RepresentativeEntry[],
  jobEntryCount: number | null,
): RepresentativeEntry[] {
  if (jobEntryCount === null || entries.length <= jobEntryCount) {
    return entries;
  }

  const limitedEntries = entries.slice(0, jobEntryCount);
  logPhase('representative', `Representative entries trimmed to job count before resolution: ${limitedEntries.length}`);
  return limitedEntries;
}

async function resolveRepresentativeEntries(
  page: Page,
  entries: RepresentativeEntry[],
  blockedEntries: RepresentativeEntry[],
): Promise<ResolvedRepresentativeEntries> {
  const resolvedEntries: RepresentativeEntry[] = [];
  const unresolvedEntries: RepresentativeEntry[] = [];
  const partialEntryGroups = groupPartialEntries(entries, resolvedEntries, unresolvedEntries);

  let groupIndex = 0;
  for (const group of partialEntryGroups.values()) {
    groupIndex += 1;
    logPhase(
      'representative',
      `Resolving partial entry group ${groupIndex}/${partialEntryGroups.size}: ${formatSeekLotFilterLabel(group.filter)} x${group.entries.length}`,
    );
    await updateJobProgress(`代表指定の応募先探索中... ${groupIndex}/${partialEntryGroups.size}条件`);

    try {
      const resolved = await runSeekLotComparePage(page, group.entries.length, {
        filter: group.filter,
        blockedEntries,
        excludedEntries: resolvedEntries,
      });

      resolvedEntries.push(...resolved);
      if (resolved.length < group.entries.length) {
        const unresolvedGroupEntries = group.entries.slice(resolved.length);
        unresolvedEntries.push(...unresolvedGroupEntries);
        logEarlyReturn(
          `[representative] 条件に合う抽選応募先が不足しました: ${formatSeekLotFilterLabel(group.filter)} ` +
          `${resolved.length}/${group.entries.length}件`,
        );
      }
    } catch (error) {
      unresolvedEntries.push(...group.entries);
      logEarlyReturn(
        `[representative] 部分指定の探索に失敗しました: ${formatSeekLotFilterLabel(group.filter)} ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    entries: resolvedEntries,
    unresolvedEntries,
  };
}

function groupPartialEntries(
  entries: RepresentativeEntry[],
  completeEntries: RepresentativeEntry[],
  unresolvedEntries: RepresentativeEntry[],
): Map<string, PartialEntryGroup> {
  const groups = new Map<string, PartialEntryGroup>();

  for (const entry of entries) {
    if (isCompleteEntry(entry)) {
      completeEntries.push(entry);
      continue;
    }

    const seekFilter = buildSeekFilterForRepresentativeEntry(entry);
    if (!seekFilter) {
      unresolvedEntries.push(entry);
      logEarlyReturn(`[representative] 対応していない欠落形式のため通常応募へ流さず失敗扱いにします: ${formatEntryLabel(entry)}`);
      continue;
    }

    const groupKey = buildPartialEntryGroupKey(seekFilter);
    if (!groupKey) {
      unresolvedEntries.push(entry);
      logEarlyReturn(`[representative] 部分指定の形式が不正なため探索できません: ${formatEntryLabel(entry)}`);
      continue;
    }

    const group = groups.get(groupKey);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(groupKey, {
        filter: seekFilter,
        entries: [entry],
      });
    }
  }

  return groups;
}

async function fetchExistingRequestEntries(page: Page, targetYearMonths: string[]): Promise<RepresentativeEntry[]> {
  const entries: RepresentativeEntry[] = [];

  logPhase('request-status', `Fetching already requested entries for months: ${targetYearMonths.join(', ')}`);
  for (const targetYearMonth of targetYearMonths) {
    for (const filter of REQUEST_STATUS_FILTERS) {
      await page.goto(REQUEST_STATUS_INDEX_URL, { waitUntil: 'domcontentloaded' });
      const filteredEntries = await ensureRequestStatusPage(page, filter, undefined, {
        targetYearMonth,
        captureScreenshots: false,
      });

      for (const entry of filteredEntries) {
        if (!entries.some(existingEntry => entriesAreEquivalent(existingEntry, entry))) {
          entries.push(entry);
        }
      }
    }
  }
  logPhase('request-status', `Already requested entries: ${entries.length}`);

  return entries;
}

function selectUnresolvedFailures(
  unresolvedEntries: RepresentativeEntry[],
  resolvedEntryCount: number,
  jobEntryCount: number | null,
): RepresentativeEntry[] {
  if (jobEntryCount === null) {
    return unresolvedEntries;
  }

  const remainingFailureSlots = Math.max(jobEntryCount - resolvedEntryCount, 0);
  return unresolvedEntries.slice(0, remainingFailureSlots);
}

function collectRequestStatusTargetMonths(entries: RepresentativeEntry[], includeDefaultMonth: boolean): string[] {
  const targetMonths = new Set<string>();

  entries.forEach(entry => {
    const dateIso = normalizeDateToIso(entry.date);
    if (dateIso) {
      targetMonths.add(dateIso.slice(0, 7));
    }
  });

  if (includeDefaultMonth || targetMonths.size === 0) {
    targetMonths.add(getDefaultSearchYearMonth());
  }

  return [...targetMonths];
}

function getDefaultSearchYearMonth(): string {
  return getNextMonthYearMonth(JST_TIMEZONE);
}

function isCompleteEntry(entry: RepresentativeEntry): boolean {
  return hasText(entry.gymName) && hasText(entry.room) && hasText(entry.date) && hasText(entry.time);
}

function buildPartialEntryGroupKey(filter: SeekLotFilter): string | null {
  const dateIso = normalizeDateToIso(filter.date);
  const timeRange = hasText(filter.time) ? normalizeTimeRange(filter.time) : null;
  if (!dateIso || (hasText(filter.time) && !timeRange)) {
    return null;
  }

  return `${dateIso}|${timeRange?.label ?? ''}`;
}
