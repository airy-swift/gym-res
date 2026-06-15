import { RepresentativeDrawer } from "@/components/navigation/representative-drawer";
import { StartJobForm } from "@/components/start-job-form";
import { ensureValidGroupAccess, isCurrentUserGroupRepresentative } from "@/lib/util/group-access";

const numbers = Array.from({ length: 20 }, (_, index) => index + 1);
const DEFAULT_ENTRY_COUNT = 15;

type HomePageSearchParams = {
  gp?: string;
};

type HomePageProps = {
  searchParams?: Promise<HomePageSearchParams> | HomePageSearchParams;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;

  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null);
  const normalizedGroupName = typeof group.name === "string" ? group.name : "";
  const pageTitle = normalizedGroupName || "サークル";
  const groupLabel = pageTitle;
  const representativeCount = Array.isArray(group.list) ? group.list.length : 0;
  const maxEntryOption = numbers[numbers.length - 1] ?? 1;
  const defaultEntryCount = Math.max(1, Math.min(DEFAULT_ENTRY_COUNT, maxEntryOption));
  const canShowRepresentativeDrawer = await isCurrentUserGroupRepresentative(group);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="w-full max-w-2xl px-0 py-8 sm:px-6">
        <header className="mb-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Gym Reserver</p>
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
              {canShowRepresentativeDrawer ? (
                <RepresentativeDrawer groupId={group.id} groupName={group.name} activePath="/" />
              ) : null}
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

        <StartJobForm
          entryOptions={numbers}
          groupId={group.id}
          defaultEntryCount={defaultEntryCount}
          representativeEntryCount={representativeCount}
          groupLabel={groupLabel}
        />
      </section>
    </main>
  );
}
