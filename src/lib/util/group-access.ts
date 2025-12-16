import { redirect } from "next/navigation";

import { getGroupDocument, type GroupDocument } from "@/lib/firebase";

const UNAUTHORIZED_PATH = "/unauthorized";

type GroupAccessOptions = {
  representativeId?: string | null;
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

  return group;
}
