import { redirect } from "next/navigation";

import { getGroupDocument, type GroupDocument } from "@/lib/firebase";

const UNAUTHORIZED_PATH = "/unauthorized";

export async function ensureValidGroupAccess(groupId?: string | null): Promise<GroupDocument> {
  if (!groupId) {
    redirect(UNAUTHORIZED_PATH);
  }

  const group = await getGroupDocument(groupId);

  if (!group) {
    redirect(UNAUTHORIZED_PATH);
  }

  return group;
}
