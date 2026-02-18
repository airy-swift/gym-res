import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase/app";
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
  imagePaths: string[];
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
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";

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
              applications配下の画像を日時ごとに表示します。
            </p>
            <p className="mt-1 text-xs text-stone-500">
              対象: {imageGroups.length}件 / 画像: {totalImageCount}枚
            </p>
          </div>
        </header>

        {!storageBucket ? (
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
            {imageGroups.map((groupItem) => (
              <section
                key={groupItem.docId}
                className="rounded-3xl border border-stone-200 bg-white/80 p-6 shadow-sm"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                  <p className="font-semibold text-stone-700">取得日時</p>
                  <p>{formatTimestamp(groupItem.timestampMs)} / {groupItem.imagePaths.length}枚</p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {groupItem.imagePaths.map((imagePath) => {
                    const imageUrl = buildStorageImageUrl(storageBucket, imagePath);

                    return (
                      <div
                        key={`${groupItem.docId}-${imagePath}`}
                        className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50"
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt="application"
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
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

      const data = docSnapshot.data() as { images?: unknown } | undefined;
      const imagePaths = Array.isArray(data?.images)
        ? data.images.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];

      return {
        docId: docSnapshot.id,
        timestampMs,
        imagePaths,
      } satisfies ApplicationImageGroup;
    })
    .filter((value): value is ApplicationImageGroup => value !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  return groups;
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

function formatTimestamp(timestampMs: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestampMs));
}
