import type { RepresentativeEntry } from './types';

export type TimeRange = {
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
  label: string;
};

export type SeekLotFilter = {
  date?: string;
  time?: string;
};

export type NormalizedSeekLotFilter = {
  dateIso?: string;
  timeRange?: TimeRange;
};

type ParsedTimeSegment = {
  label: string;
  minutes: number;
};

export function normalizeDateToIso(value?: string | null): string | null {
  const normalized = (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();

  if (!normalized) {
    return null;
  }

  const japaneseMatch = normalized.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (japaneseMatch) {
    return buildIsoDate(japaneseMatch[1], japaneseMatch[2], japaneseMatch[3]);
  }

  const separatedMatch = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (separatedMatch) {
    return buildIsoDate(separatedMatch[1], separatedMatch[2], separatedMatch[3]);
  }

  return null;
}

export function formatJapaneseDateFromIso(rawDate: string): string {
  const isoDate = normalizeDateToIso(rawDate);
  if (!isoDate) {
    return rawDate;
  }

  const [yearPart, monthPart, dayPart] = isoDate.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getUTCDay()];

  return `${year}年${month}月${day}日(${weekday})`;
}

export function normalizeTimeRange(value?: string | null): TimeRange | null {
  const normalized = (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[〜～−ー－–—]/g, '-')
    .trim();

  if (!normalized) {
    return null;
  }

  const parts = normalized.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const start = parseTimeSegment(parts[0]);
  const end = parseTimeSegment(parts[1]);
  if (!start || !end || start.minutes >= end.minutes) {
    return null;
  }

  return {
    start: start.label,
    end: end.label,
    startMinutes: start.minutes,
    endMinutes: end.minutes,
    label: `${start.label}-${end.label}`,
  };
}

export function normalizeSeekLotFilter(filter?: SeekLotFilter): NormalizedSeekLotFilter | null {
  if (!filter) {
    return {};
  }

  const hasDate = Boolean(filter.date?.trim());
  const hasTime = Boolean(filter.time?.trim());
  const dateIso = hasDate ? normalizeDateToIso(filter.date) : undefined;
  const timeRange = hasTime ? normalizeTimeRange(filter.time) : undefined;

  if ((hasDate && !dateIso) || (hasTime && !timeRange)) {
    return null;
  }

  return {
    ...(dateIso ? { dateIso } : {}),
    ...(timeRange ? { timeRange } : {}),
  };
}

export function buildSeekFilterForRepresentativeEntry(entry: RepresentativeEntry): SeekLotFilter | null {
  if (!hasText(entry.date)) {
    return null;
  }

  if (hasText(entry.gymName) || hasText(entry.room)) {
    return null;
  }

  return {
    date: entry.date,
    ...(hasText(entry.time) ? { time: entry.time } : {}),
  };
}

export function entryMatchesSeekFilter(
  entry: RepresentativeEntry,
  filter?: NormalizedSeekLotFilter,
): boolean {
  if (!filter) {
    return true;
  }

  if (filter.dateIso && normalizeDateToIso(entry.date) !== filter.dateIso) {
    return false;
  }

  if (filter.timeRange) {
    const entryTimeRange = normalizeTimeRange(entry.time);
    if (!entryTimeRange) {
      return false;
    }
    if (
      entryTimeRange.startMinutes !== filter.timeRange.startMinutes ||
      entryTimeRange.endMinutes !== filter.timeRange.endMinutes
    ) {
      return false;
    }
  }

  return true;
}

export function entriesAreEquivalent(lhs: RepresentativeEntry, rhs: RepresentativeEntry): boolean {
  return buildFullEntryKey(lhs) === buildFullEntryKey(rhs);
}

export function entriesShareApplicationSlot(lhs: RepresentativeEntry, rhs: RepresentativeEntry): boolean {
  const lhsKey = buildApplicationSlotKey(lhs);
  const rhsKey = buildApplicationSlotKey(rhs);
  return lhsKey !== null && lhsKey === rhsKey;
}

export function entriesConflictWithExistingRequest(
  existingRequest: RepresentativeEntry,
  candidate: RepresentativeEntry,
): boolean {
  return entriesShareApplicationSlot(existingRequest, candidate) || entriesAreEquivalent(existingRequest, candidate);
}

export function normalizeEntryForComparison(entry: RepresentativeEntry): RepresentativeEntry {
  return {
    gymName: normalizeComparableText(entry.gymName),
    room: normalizeComparableText(entry.room),
    date: normalizeDateToIso(entry.date) ?? normalizeComparableText(entry.date),
    time: normalizeTimeRange(entry.time)?.label ?? normalizeComparableText(entry.time),
  };
}

export function compareEntriesForStableOrder(lhs: RepresentativeEntry, rhs: RepresentativeEntry): number {
  const lhsDate = normalizeDateToIso(lhs.date) ?? '';
  const rhsDate = normalizeDateToIso(rhs.date) ?? '';
  const dateDiff = lhsDate.localeCompare(rhsDate, 'ja');
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const lhsTime = normalizeTimeRange(lhs.time);
  const rhsTime = normalizeTimeRange(rhs.time);
  const timeDiff = (lhsTime?.startMinutes ?? Number.MAX_SAFE_INTEGER) - (rhsTime?.startMinutes ?? Number.MAX_SAFE_INTEGER);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  const gymDiff = normalizeComparableText(lhs.gymName).localeCompare(normalizeComparableText(rhs.gymName), 'ja');
  if (gymDiff !== 0) {
    return gymDiff;
  }

  return normalizeComparableText(lhs.room).localeCompare(normalizeComparableText(rhs.room), 'ja');
}

export function hasText(value?: string | null): boolean {
  return (value ?? '').trim().length > 0;
}

export function formatEntryLabel(entry: RepresentativeEntry): string {
  const gym = entry.gymName || '施設未指定';
  const room = entry.room || '部屋未指定';
  const date = entry.date || '日付未指定';
  const time = entry.time || '時間未指定';
  return `${gym} / ${room} / ${date} ${time}`;
}

export function formatSeekLotFilterLabel(filter: SeekLotFilter): string {
  const date = normalizeDateToIso(filter.date) ?? filter.date ?? '日付未指定';
  const time = hasText(filter.time) ? normalizeTimeRange(filter.time)?.label ?? filter.time : '時間指定なし';
  return `${date} ${time}`;
}

export function getNextMonthYearMonth(timeZone: string): string {
  const now = new Date();
  const zonedTimestamp = new Date(now.toLocaleString('en-US', { timeZone }));
  const nextMonth = new Date(zonedTimestamp.getFullYear(), zonedTimestamp.getMonth() + 1, 1);
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
}

function buildFullEntryKey(entry: RepresentativeEntry): string {
  const normalized = normalizeEntryForComparison(entry);
  return [normalized.gymName, normalized.room, normalized.date, normalized.time].join('|');
}

function buildApplicationSlotKey(entry: RepresentativeEntry): string | null {
  const normalized = normalizeEntryForComparison(entry);
  if (!normalized.gymName || !normalized.date || !normalized.time) {
    return null;
  }
  return [normalized.gymName, normalized.date, normalized.time].join('|');
}

function normalizeComparableText(value?: string | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim();
}

function buildIsoDate(yearValue: string, monthValue: string, dayValue: string): string | null {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTimeSegment(value?: string): ParsedTimeSegment | null {
  const segment = value?.trim() ?? '';
  if (!segment) {
    return null;
  }

  const colonMatch = segment.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    return buildTimeSegment(colonMatch[1], colonMatch[2]);
  }

  const japaneseMatch = segment.match(/^(\d{1,2})時(?:(\d{1,2})分?)?$/);
  if (japaneseMatch) {
    return buildTimeSegment(japaneseMatch[1], japaneseMatch[2] ?? '00');
  }

  const compactMatch = segment.match(/^(\d{3,4})$/);
  if (compactMatch) {
    const compact = compactMatch[1];
    const hour = compact.length === 3 ? compact.slice(0, 1) : compact.slice(0, 2);
    const minute = compact.slice(-2);
    return buildTimeSegment(hour, minute);
  }

  const hourOnlyMatch = segment.match(/^(\d{1,2})$/);
  if (hourOnlyMatch) {
    return buildTimeSegment(hourOnlyMatch[1], '00');
  }

  return null;
}

function buildTimeSegment(hourValue: string, minuteValue: string): ParsedTimeSegment | null {
  const hour = Number(hourValue);
  const minute = Number(minuteValue);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 24 ||
    minute < 0 ||
    minute > 59 ||
    (hour === 24 && minute !== 0)
  ) {
    return null;
  }

  return {
    label: `${hour}:${String(minute).padStart(2, '0')}`,
    minutes: hour * 60 + minute,
  };
}
