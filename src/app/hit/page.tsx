import Link from "next/link";

import { HitIdsForm } from "@/components/hit/ids-form";
import { decodeGroupIdsForDisplay } from "@/lib/security/group-ids-crypto";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

type HitPageSearchParams = {
  gp?: string;
  wl?: string;
};

type HitPageProps = {
  searchParams?: Promise<HitPageSearchParams> | HitPageSearchParams;
};

export default async function HitPage({ searchParams }: HitPageProps) {
  const resolvedSearchParams = await searchParams;

  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null);
  const pageTitle = group.name ?? "サークル";
  const representativeId = resolvedSearchParams?.wl ?? null;
  const query = new URLSearchParams({ gp: group.id });

  if (representativeId) {
    query.set("wl", representativeId);
  }

  const homeHref = `/?${query.toString()}`;
  const representativeHref = `/representative?${query.toString()}`;
  const bulkHref = `/bulk?${query.toString()}`;
  const initialIds = decodeGroupIdsForDisplay(group.ids);

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
            </div>
          </div>
          <div className="border-l-4 border-stone-400/70 pl-6">
            <h1 className="text-2xl font-semibold text-stone-900">サークル: {pageTitle}</h1>
            <p className="mt-2 text-sm text-stone-600">
              抽選状況自動確認用のIDを保存します。毎月11日と23日の9:00頃から起動し9:15までに抽選状況を自動取得します。
            </p>
          </div>
        </header>

        <div className="rounded-3xl border border-stone-200 bg-white/80 p-8 shadow-sm">
          <HitIdsForm groupId={group.id} initialValue={initialIds} />
        </div>
      </section>
    </main>
  );
}
