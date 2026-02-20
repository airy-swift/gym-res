import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";

import { getFirestoreDb, getStorageBucketName } from "@/lib/firebase/app";
import { addMonths, formatMonthLabel, getTodayInJst } from "@/lib/date/jst";
import { HitResultsList, type HitResultRowItem } from "@/components/results/hit-results-list";
import { ResultsImageGallery } from "@/components/results/image-gallery";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

type ResultsPageSearchParams = {
  gp?: string;
  ym?: string;
};

type ResultsPageProps = {
  searchParams?: Promise<ResultsPageSearchParams> | ResultsPageSearchParams;
};

type MonthCursor = {
  year: number;
  month: number;
};

type ApplicationImageGroup = {
  createdAtMs: number;
  docId: string;
  hits: string[];
  imagePaths: string[];
};

type AggregatedHitRow = HitResultRowItem & {
  sortDateMs: number | null;
  sourceTimestampMs: number;
};

const JST_YEAR_MONTH_FORMATTER = new Intl.DateTimeFormat("ja-JP-u-ca-gregory", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
});

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const resolvedSearchParams = await searchParams;
  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null);

  const selectedMonth = resolveSelectedMonth(resolvedSearchParams?.ym);
  const previousMonth = shiftMonth(selectedMonth, -1);
  const nextMonth = shiftMonth(selectedMonth, 1);
  const monthLabel = formatMonthLabel({ year: selectedMonth.year, month: selectedMonth.month, day: 1 });
  const previousMonthHref = buildResultsHref({
    groupId: group.id,
    yearMonth: toYearMonthKey(previousMonth),
  });
  const nextMonthHref = buildResultsHref({
    groupId: group.id,
    yearMonth: toYearMonthKey(nextMonth),
  });

  const query = new URLSearchParams({ gp: group.id });
  const homeHref = `/?${query.toString()}`;

  const allImageGroups = await getAllApplicationImageGroups(group.id);
  const imageGroups = filterGroupsByMonth(allImageGroups, selectedMonth);
  const totalImageCount = imageGroups.reduce((sum, groupItem) => sum + groupItem.imagePaths.length, 0);
  const totalHitCount = imageGroups.reduce((sum, groupItem) => sum + groupItem.hits.length, 0);
  const storageBucket = resolveStorageBucket();
  const aggregatedHitRows = buildAggregatedHitRows(imageGroups);
  const resultImageUrls = buildResultImageUrls(imageGroups, storageBucket);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="w-full max-w-5xl px-0 py-8 sm:px-6">
        <header className="mb-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Gym Reserver</p>
            <Link
              href={homeHref}
              className="inline-flex items-center gap-2 rounded-full border border-stone-900/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-700 transition hover:border-stone-900/30 hover:text-stone-900"
            >
              トップページへ
            </Link>
          </div>
          <div className="border-l-4 border-stone-400/70 pl-6">
            <h1 className="text-2xl font-semibold text-stone-900">抽選状況確認</h1>
            <p className="mt-2 text-sm text-stone-600">
              抽選結果は項目をクリックでコピーできます。画像はクリックで拡大表示できます。
            </p>
            <p className="mt-2 text-xs text-stone-500">
              対象: {imageGroups.length}件 / 抽選行: {totalHitCount}件 / 画像: {totalImageCount}枚
            </p>
          </div>
        </header>

        <div className="mb-6 flex justify-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-stone-700">
            <Link
              href={previousMonthHref}
              aria-label="前月へ"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 transition hover:border-stone-500 hover:text-stone-900"
            >
              ←
            </Link>
            <p className="min-w-[7rem] text-center font-semibold">{monthLabel}</p>
            <Link
              href={nextMonthHref}
              aria-label="次月へ"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 transition hover:border-stone-500 hover:text-stone-900"
            >
              →
            </Link>
          </div>
        </div>

        {!storageBucket && totalImageCount > 0 ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET が未設定のため画像URLを生成できません。
          </div>
        ) : null}

        {imageGroups.length === 0 ? (
          <div className="rounded-3xl border border-stone-200 bg-white/80 p-8 text-sm text-stone-600 shadow-sm">
            抽選確認データはありませんでした。
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-3xl border border-stone-200 bg-white/80 p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                <p className="font-semibold text-stone-700">抽選結果</p>
                <p>合計 {totalHitCount} 行</p>
              </div>
              <HitResultsList rows={aggregatedHitRows} />
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white/80 p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                <p className="font-semibold text-stone-700">画像一覧</p>
                <p>取得アカウント数: {imageGroups.length}</p>
              </div>
              <ResultsImageGallery imageUrls={resultImageUrls} />
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function resolveStorageBucket(): string {
  try {
    return getStorageBucketName();
  } catch {
    return "";
  }
}

async function getAllApplicationImageGroups(
  groupId: string,
): Promise<ApplicationImageGroup[]> {
  const db = getFirestoreDb();
  const snapshot = await getDocs(collection(db, "groups", groupId, "applications"));

  const groups = snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() as { hits?: unknown; images?: unknown; created_at?: unknown } | undefined;
      const createdAtMs = parseCreatedAtMs(data?.created_at) ?? parseTimestampDocId(docSnapshot.id);
      if (createdAtMs === null) {
        return null;
      }

      const hits = Array.isArray(data?.hits)
        ? data.hits.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      const imagePaths = Array.isArray(data?.images)
        ? data.images.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];

      return {
        docId: docSnapshot.id,
        createdAtMs,
        hits,
        imagePaths,
      } satisfies ApplicationImageGroup;
    })
    .filter((value): value is ApplicationImageGroup => value !== null)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  return groups;
}

function buildAggregatedHitRows(groups: ApplicationImageGroup[]): AggregatedHitRow[] {
  const rows: AggregatedHitRow[] = groups.flatMap((groupItem) =>
    groupItem.hits.map((line, index) => {
      const parsed = parseHitLine(line);
      return {
        key: `${groupItem.docId}-${index}-${line}`,
        ...parsed,
        sourceTimestampMs: groupItem.createdAtMs,
      };
    }),
  );

  rows.sort((a, b) => {
    if (a.sortDateMs !== null && b.sortDateMs !== null && a.sortDateMs !== b.sortDateMs) {
      return a.sortDateMs - b.sortDateMs;
    }
    if (a.sortDateMs !== null && b.sortDateMs === null) {
      return -1;
    }
    if (a.sortDateMs === null && b.sortDateMs !== null) {
      return 1;
    }
    if (a.sourceTimestampMs !== b.sourceTimestampMs) {
      return a.sourceTimestampMs - b.sourceTimestampMs;
    }
    const byGym = a.gymName.localeCompare(b.gymName, "ja");
    if (byGym !== 0) {
      return byGym;
    }
    return a.time.localeCompare(b.time, "ja");
  });

  return rows;
}

function buildResultImageUrls(
  groups: ApplicationImageGroup[],
  storageBucket: string,
): string[] {
  return groups.flatMap((groupItem) =>
    groupItem.imagePaths
      .map((imagePath) => buildStorageImageUrl(storageBucket, imagePath))
      .filter((url): url is string => Boolean(url)),
  );
}

function parseHitLine(line: string): Omit<AggregatedHitRow, "key" | "sourceTimestampMs"> {
  const columns = line.split("\t").map((value) => value.trim());
  const hasStatusPrefix = columns.length >= 5 && ["HIT", "FIXED"].includes((columns[0] ?? "").toUpperCase());

  const date = hasStatusPrefix ? columns[1] ?? "" : columns[0] ?? "";
  const time = hasStatusPrefix ? columns[2] ?? "" : columns[1] ?? "";
  const gymName = hasStatusPrefix ? columns[3] ?? "" : columns[2] ?? "";
  const room = hasStatusPrefix ? columns[4] ?? "" : columns[3] ?? "";

  return {
    date,
    time,
    gymName,
    room,
    sortDateMs: parseJapaneseDateLabel(date),
  };
}

function parseJapaneseDateLabel(dateText: string): number | null {
  const match = dateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getTime();
}

function parseTimestampDocId(docId: string): number | null {
  const trimmed = docId.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);
  const normalized = normalizeEpochMs(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  return normalized;
}

function parseCreatedAtMs(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  if (typeof value === "number") {
    const normalized = normalizeEpochMs(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return normalizeEpochMs(numeric);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  if (typeof value === "object") {
    const candidate = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) && millis > 0 ? millis : null;
    }

    if (typeof candidate.seconds === "number") {
      const nanoseconds = typeof candidate.nanoseconds === "number" ? candidate.nanoseconds : 0;
      const millis = candidate.seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
      return Number.isFinite(millis) && millis > 0 ? millis : null;
    }
  }

  return null;
}

function normalizeEpochMs(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function buildStorageImageUrl(storageBucket: string, imagePath: string): string | null {
  const trimmed = imagePath.trim();

  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }

  return `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(trimmed)}?alt=media`;
}

function resolveSelectedMonth(rawYearMonth: string | undefined): MonthCursor {
  const parsed = parseYearMonth(rawYearMonth);
  if (parsed) {
    return parsed;
  }

  const today = getTodayInJst();
  const nextMonth = addMonths({ year: today.year, month: today.month, day: 1 }, 1);
  return { year: nextMonth.year, month: nextMonth.month };
}

function parseYearMonth(value: string | undefined): MonthCursor | null {
  const match = value?.trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || !month) {
    return null;
  }

  return { year, month };
}

function toYearMonthKey(month: MonthCursor): string {
  return `${month.year}-${month.month.toString().padStart(2, "0")}`;
}

function shiftMonth(month: MonthCursor, diff: number): MonthCursor {
  const shifted = addMonths({ year: month.year, month: month.month, day: 1 }, diff);
  return { year: shifted.year, month: shifted.month };
}

function filterGroupsByMonth(groups: ApplicationImageGroup[], targetMonth: MonthCursor): ApplicationImageGroup[] {
  return groups.filter((groupItem) => {
    const groupMonth = resolveDisplayMonthForGroup(groupItem);
    if (!groupMonth) {
      return false;
    }
    return groupMonth.year === targetMonth.year && groupMonth.month === targetMonth.month;
  });
}

function resolveDisplayMonthForGroup(groupItem: ApplicationImageGroup): MonthCursor | null {
  for (const line of groupItem.hits) {
    const parsed = parseHitLine(line);
    const hitMonth = parseYearMonthFromDateLabel(parsed.date);
    if (hitMonth) {
      return hitMonth;
    }
  }

  const createdMonth = extractJstYearMonth(groupItem.createdAtMs);
  if (!createdMonth) {
    return null;
  }
  return shiftMonth(createdMonth, 1);
}

function parseYearMonthFromDateLabel(dateText: string): MonthCursor | null {
  const match = dateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || !month || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
}

function extractJstYearMonth(timestampMs: number): MonthCursor | null {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = JST_YEAR_MONTH_FORMATTER.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!year || !month) {
    return null;
  }

  return { year, month };
}

function buildResultsHref(params: {
  groupId: string;
  yearMonth: string;
}): string {
  const query = new URLSearchParams({
    gp: params.groupId,
    ym: params.yearMonth,
  });
  return `/results?${query.toString()}`;
}
