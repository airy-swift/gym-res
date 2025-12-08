import { GroupUrlsForm } from "@/components/representative/group-urls-form";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

type RepresentativePageProps = {
  searchParams?: Promise<{ gp?: string }> | { gp?: string };
};

export default async function RepresentativePage({ searchParams }: RepresentativePageProps) {
  const resolvedSearchParams = await searchParams;
  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null);
  const urlsText = Array.isArray(group.urls) ? group.urls.join("\n") : "";

  return (
    <main className="min-h-screen bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="mx-auto w-full max-w-3xl space-y-6 rounded-[32px] border border-stone-200/70 bg-white/80 p-10 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Representative</p>
          <h1 className="mt-3 text-2xl font-semibold text-stone-900">サークル: {group.name ?? group.id}</h1>
          <p className="mt-2 text-sm text-stone-600">抽選応募URLを改行区切りで入力してください。</p>
        </div>

        <GroupUrlsForm groupId={group.id} initialValue={urlsText} />
      </section>
    </main>
  );
}
