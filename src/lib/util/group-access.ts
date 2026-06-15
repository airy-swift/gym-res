import { redirect } from "next/navigation";

import { getGroupDocument, type GroupDocument } from "@/lib/firebase";
import { resolveWebUserIdFromCookie } from "@/lib/auth/web-session";
import { isGroupUserEnabled } from "@/lib/auth/group-white-list";
import { buildAuthPath } from "@/lib/navigation/group-paths";

const UNAUTHORIZED_PATH = "/unauthorized";

type GroupAccessOptions = {
  requireWhitelistedUser?: boolean;
  nextPath?: string | null;
};

export type GroupAccessState =
  | { status: "authorized"; group: GroupDocument }
  | { status: "auth_required"; group: GroupDocument }
  | { status: "invalid" };

export async function ensureValidGroupAccess(
  groupId?: string | null,
  options?: GroupAccessOptions,
): Promise<GroupDocument> {
  const accessState = await getGroupAccessState(groupId, options);

  if (accessState.status === "invalid") {
    redirect(UNAUTHORIZED_PATH);
  }

  if (accessState.status === "auth_required") {
    redirect(buildAuthPath(accessState.group.id, options?.nextPath ?? null));
  }

  return accessState.group;
}

export async function getGroupAccessState(
  groupId?: string | null,
  options?: Pick<GroupAccessOptions, "requireWhitelistedUser">,
): Promise<GroupAccessState> {
  if (!groupId) {
    return { status: "invalid" };
  }

  const group = await getGroupDocument(groupId);

  if (!group) {
    return { status: "invalid" };
  }

  if (!options?.requireWhitelistedUser) {
    return { status: "authorized", group };
  }

  const uid = await resolveWebUserIdFromCookie();

  if (!uid || !isGroupUserEnabled(group.white, uid)) {
    return { status: "auth_required", group };
  }

  return { status: "authorized", group };
}

export async function isCurrentUserGroupRepresentative(group: GroupDocument): Promise<boolean> {
  const uid = await resolveWebUserIdFromCookie();
  return uid ? isGroupUserEnabled(group.white, uid) : false;
}
