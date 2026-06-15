import { redirect } from "next/navigation";

import { WebSessionBridge } from "@/components/auth/web-session-bridge";
import { HitIdsForm } from "@/components/hit/ids-form";
import { RepresentativeDrawer } from "@/components/navigation/representative-drawer";
import { decodeGroupIdsForDisplay } from "@/lib/security/group-ids-crypto";
import { getGroupAccessState } from "@/lib/util/group-access";
import { buildGroupPath } from "@/lib/navigation/group-paths";

type HitPageSearchParams = {
  gp?: string;
};

type HitPageProps = {
  searchParams?: Promise<HitPageSearchParams> | HitPageSearchParams;
};

export default async function HitPage({ searchParams }: HitPageProps) {
  const resolvedSearchParams = await searchParams;
  const groupId = resolvedSearchParams?.gp ?? null;
  const nextPath = groupId ? buildGroupPath("/hit", groupId) : "/hit";

  const accessState = await getGroupAccessState(groupId, {
    requireWhitelistedUser: true,
  });

  if (accessState.status === "invalid") {
    redirect("/unauthorized");
  }

  if (accessState.status === "auth_required") {
    return <WebSessionBridge groupId={accessState.group.id} nextPath={nextPath} />;
  }

  const group = accessState.group;
  const pageTitle = group.name ?? "サークル";

  const initialIds = decodeGroupIdsForDisplay(group.ids);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="w-full max-w-2xl px-0 py-8 sm:px-6">
        <header className="mb-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-500">Gym Reserver</p>
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
              <RepresentativeDrawer groupId={group.id} groupName={group.name} activePath="/hit" />
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
