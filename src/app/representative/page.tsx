import { RepresentativePageClient, type RepresentativeEntry } from "@/components/representative/page-client";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

type RepresentativePageProps = {
  searchParams?: Promise<{ gp?: string; wl?: string }> | { gp?: string; wl?: string };
};

export default async function RepresentativePage({ searchParams }: RepresentativePageProps) {
  const resolvedSearchParams = await searchParams;
  const group = await ensureValidGroupAccess(resolvedSearchParams?.gp ?? null, {
    representativeId: resolvedSearchParams?.wl ?? null,
  });

  const initialEntries: RepresentativeEntry[] = Array.isArray(group.list)
    ? group.list.map((entry) => ({
        gymName: typeof entry.gymName === "string" ? entry.gymName : "",
        room: typeof entry.room === "string" ? entry.room : "",
        date: typeof entry.date === "string" ? entry.date : "",
        time: typeof entry.time === "string" ? entry.time : "",
      }))
    : [];

  return (
    <RepresentativePageClient
      groupId={group.id}
      groupName={group.name}
      initialEntries={initialEntries}
    />
  );
}
