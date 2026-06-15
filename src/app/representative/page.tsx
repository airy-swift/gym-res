import { redirect } from "next/navigation";

import { WebSessionBridge } from "@/components/auth/web-session-bridge";
import { RepresentativeDrawer } from "@/components/navigation/representative-drawer";
import { RepresentativePageClient, type RepresentativeEntry } from "@/components/representative/page-client";
import { getGroupAccessState } from "@/lib/util/group-access";
import { buildGroupPath } from "@/lib/navigation/group-paths";

type RepresentativePageProps = {
  searchParams?: Promise<{ gp?: string }> | { gp?: string };
};

export default async function RepresentativePage({ searchParams }: RepresentativePageProps) {
  const resolvedSearchParams = await searchParams;
  const groupId = resolvedSearchParams?.gp ?? null;
  const nextPath = groupId ? buildGroupPath("/representative", groupId) : "/representative";
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

  const initialEntries: RepresentativeEntry[] = Array.isArray(group.list)
    ? group.list.map((entry) => ({
        gymName: typeof entry.gymName === "string" ? entry.gymName : "",
        room: typeof entry.room === "string" ? entry.room : "",
        date: typeof entry.date === "string" ? entry.date : "",
        time: typeof entry.time === "string" ? entry.time : "",
      }))
    : [];

  return (
    <>
      <div className="fixed right-6 top-6 z-40 sm:right-10">
        <RepresentativeDrawer groupId={group.id} groupName={group.name} activePath="/representative" />
      </div>
      <RepresentativePageClient
        groupId={group.id}
        groupName={group.name}
        initialEntries={initialEntries}
      />
    </>
  );
}
