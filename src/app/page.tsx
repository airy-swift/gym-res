import Link from "next/link";

import { StartJobForm } from "@/components/start-job-form";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

const numbers = Array.from({ length: 15 }, (_, index) => index + 1);

type HomePageSearchParams = {
  gp?: string;
};

type HomePageProps = {
  searchParams?: Promise<HomePageSearchParams> | HomePageSearchParams;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;

  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null);
  const pageTitle = group.name ?? "サークル";
  const representativeHref = `/representative?gp=${encodeURIComponent(group.id)}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="w-full max-w-2xl px-0 py-8 sm:px-6">
        <header className="mb-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Gym Reserver</p>
            <Link
              href={representativeHref}
              className="inline-flex items-center gap-2 rounded-full border border-stone-900/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-700 transition hover:border-stone-900/30 hover:text-stone-900"
            >
              代表者向け
            </Link>
          </div>
          <div className="border-l-4 border-stone-400/70 pl-6">
            <h1 className="text-2xl font-semibold text-stone-900">サークル: {pageTitle}</h1>
            <p className="mt-2 text-sm text-stone-600">
              自動抽選応募システムに使用するアカウント情報を入力してください
            </p>
          </div>
        </header>

        <StartJobForm entryOptions={numbers} />
      </section>
    </main>
  );
}
