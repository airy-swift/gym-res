import { redirect } from "next/navigation";

import { getGroupDocument, type GroupDocument } from "@/lib/firebase";
import { resolveWebUserIdFromCookie } from "@/lib/auth/web-session";

const UNAUTHORIZED_PATH = "/unauthorized";
const AUTH_PATH = "/auth";

type GroupAccessOptions = {
  representativeId?: string | null;
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

  const shouldValidateRepresentative = options ? "representativeId" in options : false;

  if (shouldValidateRepresentative) {
    const representativeId = options?.representativeId;

    if (!representativeId) {
      redirect(UNAUTHORIZED_PATH);
    }

    const representatives = Array.isArray(group.representatives) ? group.representatives : [];

    if (!representatives.includes(representativeId)) {
      redirect(UNAUTHORIZED_PATH);
    }
  }

  if (options?.requireWhitelistedUser) {
    const uid = await resolveWebUserIdFromCookie();
    const whiteList = Array.isArray(group.white)
      ? group.white.filter((value): value is string => typeof value === "string")
      : [];

    if (!uid || !whiteList.includes(uid)) {
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
