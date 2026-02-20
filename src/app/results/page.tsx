import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";

import { getFirestoreDb, getStorageBucketName } from "@/lib/firebase/app";
import { ResultsImageGallery } from "@/components/results/image-gallery";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

type ResultsPageSearchParams = {
  gp?: string;
  wl?: string;
};

type ResultsPageProps = {
  searchParams?: Promise<ResultsPageSearchParams> | ResultsPageSearchParams;
};

type ApplicationImageGroup = {
  timestampMs: number;
  docId: string;
  hits: string[];
  imagePaths: string[];
};

type AggregatedHitRow = {
  key: string;
  line: string;
  sortDateMs: number | null;
  sourceTimestampMs: number;
};

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const resolvedSearchParams = await searchParams;
  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null);

  const representativeId = resolvedSearchParams?.wl ?? null;
  const query = new URLSearchParams({ gp: group.id });
  if (representativeId) {
    query.set("wl", representativeId);
  }

  const homeHref = `/?${query.toString()}`;
  const imageGroups = await getAllApplicationImageGroups(group.id);
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
            <p className="mt-1 text-xs text-stone-500">
              対象: {imageGroups.length}件 / 抽選行: {totalHitCount}件 / 画像: {totalImageCount}枚
            </p>
          </div>
        </header>

        {!storageBucket && totalImageCount > 0 ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET が未設定のため画像URLを生成できません。
          </div>
        ) : null}

        {imageGroups.length === 0 ? (
          <div className="rounded-3xl border border-stone-200 bg-white/80 p-8 text-sm text-stone-600 shadow-sm">
            applicationsドキュメントは見つかりませんでした。
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-3xl border border-stone-200 bg-white/80 p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                <p className="font-semibold text-stone-700">抽選結果</p>
                <p>合計 {totalHitCount} 行</p>
              </div>
              {aggregatedHitRows.length === 0 ? (
                <p className="text-sm text-stone-500">表示できる抽選結果はありません。</p>
              ) : (
                <ul className="space-y-1 text-xs text-stone-700">
                  {aggregatedHitRows.map((row) => (
                    <li key={row.key} className="font-mono whitespace-pre-wrap">
                      {row.line}
                    </li>
                  ))}
                </ul>
              )}
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
      const timestampMs = parseTimestampDocId(docSnapshot.id);

      if (timestampMs === null) {
        return null;
      }

      const data = docSnapshot.data() as { hits?: unknown; images?: unknown } | undefined;
      const hits = Array.isArray(data?.hits)
        ? data.hits.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      const imagePaths = Array.isArray(data?.images)
        ? data.images.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];

      return {
        docId: docSnapshot.id,
        timestampMs,
        hits,
        imagePaths,
      } satisfies ApplicationImageGroup;
    })
    .filter((value): value is ApplicationImageGroup => value !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  return groups;
}

function buildAggregatedHitRows(groups: ApplicationImageGroup[]): AggregatedHitRow[] {
  const rows: AggregatedHitRow[] = groups.flatMap((groupItem) =>
    groupItem.hits.map((line, index) => ({
      key: `${groupItem.docId}-${index}-${line}`,
      line,
      sortDateMs: extractDateMsFromHitLine(line),
      sourceTimestampMs: groupItem.timestampMs,
    })),
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
    return a.line.localeCompare(b.line, "ja");
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

function extractDateMsFromHitLine(line: string): number | null {
  const columns = line.split("\t").map((value) => value.trim());
  const dateText = columns[1] ?? "";
  return parseJapaneseDateLabel(dateText);
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

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
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
