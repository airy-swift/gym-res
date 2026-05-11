import { redirect } from "next/navigation";

import { getGroupDocument, type GroupDocument } from "@/lib/firebase";
import { resolveWebUserIdFromCookie } from "@/lib/auth/web-session";
import { isGroupUserEnabled } from "@/lib/auth/group-white-list";

const UNAUTHORIZED_PATH = "/unauthorized";
const AUTH_PATH = "/auth";

type GroupAccessOptions = {
  requireWhitelistedUser?: boolean;
  nextPath?: string | null;
};

export async function ensureValidGroupAccess(
  groupId?: string | null,
  options?: GroupAccessOptions,
): Promise<GroupDocument> {
  if (!groupId) {
    redirect(UNAUTHORIZED_PATH);
  }

  const group = await getGroupDocument(groupId);

  if (!group) {
    redirect(UNAUTHORIZED_PATH);
  }

  if (options?.requireWhitelistedUser) {
    const uid = await resolveWebUserIdFromCookie();

    if (!uid || !isGroupUserEnabled(group.white, uid)) {
      redirect(buildAuthRedirectPath(group.id, options.nextPath ?? null));
    }
  }

  return group;
}

function buildAuthRedirectPath(groupId: string, nextPath?: string | null): string {
  const query = new URLSearchParams({ gp: groupId });
  if (nextPath) {
    query.set("next", nextPath);
  }
  return `${AUTH_PATH}?${query.toString()}`;
}
