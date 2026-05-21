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
      redirect(buildAuthPath(group.id, options.nextPath ?? null));
    }
  }

  return group;
}
