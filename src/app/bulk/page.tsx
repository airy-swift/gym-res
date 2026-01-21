import Link from "next/link";

import { BulkConsoleForm } from "@/components/bulk/console-form";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

const entryCountOptions = Array.from({ length: 20 }, (_, index) => index + 1);

type BulkPageSearchParams = {
  gp?: string;
  wl?: string;
};

type BulkPageProps = {
  searchParams?: Promise<BulkPageSearchParams> | BulkPageSearchParams;
};

export default async function BulkPage({ searchParams }: BulkPageProps) {
  const resolvedSearchParams = await searchParams;

  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null);
  const pageTitle = group.name ?? "サークル";
  const groupLabel = pageTitle.trim().slice(0, 1) || undefined;
  const representativeCount = Array.isArray(group.list) ? group.list.length : 0;
  const maxEntryOption = entryCountOptions[entryCountOptions.length - 1] ?? 1;
  const defaultEntryCount = Math.max(1, Math.min(representativeCount || 1, maxEntryOption));
  const representativeId = resolvedSearchParams?.wl ?? null;
  const query = new URLSearchParams({ gp: group.id });

  if (representativeId) {
    query.set("wl", representativeId);
  }

  const homeHref = `/?${query.toString()}`;
  const representativeHref = `/representative?${query.toString()}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="w-full max-w-2xl px-0 py-8 sm:px-6">
        <header className="mb-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Gym Reserver</p>
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
              <Link
                href={homeHref}
                className="inline-flex items-center gap-2 rounded-full border border-stone-900/10 bg-white px-4 py-2 text-stone-700 transition hover:border-stone-900/30 hover:text-stone-900"
              >
                トップページへ
              </Link>
              <Link
                href={representativeHref}
                className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-stone-700 transition hover:border-stone-400 hover:text-stone-900"
              >
                代表ページ
              </Link>
            </div>
          </div>
          <div className="border-l-4 border-stone-400/70 pl-6">
            <h1 className="text-2xl font-semibold text-stone-900">サークル: {pageTitle}</h1>
            <p className="mt-2 text-sm text-stone-600">
              自動抽選応募システムに使用するアカウント情報を入力してください
            </p>
            <p className="mt-1 text-xs text-stone-500">
              たまに通信まわりで失敗することがあります。うまくいかないときは少し待ってからリトライしてください！
            </p>
          </div>
        </header>

        <div className="rounded-3xl border border-stone-200 bg-white/80 p-8 shadow-sm">
          <BulkConsoleForm
            groupId={group.id}
            entryOptions={entryCountOptions}
            defaultEntryCount={defaultEntryCount}
            groupLabel={groupLabel}
          />
        </div>
      </section>
    </main>
  );
}
