import type { GroupDocument } from "@/lib/firebase";
import { getGroupAccessState } from "@/lib/util/group-access";

export type GroupRepresentativeAccessResult =
  | { ok: true; group: GroupDocument }
  | { ok: false; status: 401 | 404; error: string };

export async function getGroupRepresentativeAccess(groupId: string): Promise<GroupRepresentativeAccessResult> {
  const accessState = await getGroupAccessState(groupId, {
    requireWhitelistedUser: true,
  });

  if (accessState.status === "invalid") {
    return { ok: false, status: 404, error: "Group not found" };
  }

  if (accessState.status === "auth_required") {
    return { ok: false, status: 401, error: "Authentication required" };
  }

  return { ok: true, group: accessState.group };
}
