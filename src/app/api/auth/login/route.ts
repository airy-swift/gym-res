import { NextRequest, NextResponse } from "next/server";

import { getGroupDocument } from "@/lib/firebase";
import {
  ensureDisabledGroupWhiteEntry,
  isGroupUserEnabled,
  normalizeGroupWhiteEntries,
} from "@/lib/auth/group-white-list";
import { setWebSessionCookie, verifyFirebaseIdToken } from "@/lib/auth/web-session";
import { getFirestoreRestDocument, patchFirestoreRestDocument } from "@/lib/firebase/firestore-rest";

type AuthLoginBody = {
  groupId?: unknown;
  idToken?: unknown;
};

export async function POST(request: NextRequest) {
  let body: AuthLoginBody;

  try {
    body = (await request.json()) as AuthLoginBody;
  } catch (error) {
    console.error("Invalid auth login payload", error);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";

  if (!groupId || !idToken) {
    return NextResponse.json({ error: "Missing groupId or idToken" }, { status: 400 });
  }

  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) {
    return NextResponse.json({ error: "Invalid idToken" }, { status: 401 });
  }

  const group = await getGroupDocument(groupId);
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const authorized = isGroupUserEnabled(group.white, uid);

  try {
    const now = new Date().toISOString();
    const authDocumentPath = `groups/${groupId}/auth/${uid}`;
    const existingAuth = await getFirestoreRestDocument(authDocumentPath);
    const authPayload = {
      uid,
      ...(existingAuth?.data.created_at == null ? { created_at: now } : {}),
      updated_at: now,
    };

    await patchFirestoreRestDocument(authDocumentPath, authPayload, Object.keys(authPayload));

    const latestGroup = await getGroupDocument(groupId);
    if (!latestGroup) {
      throw new Error("Group not found while updating white list");
    }

    const whiteEntries = normalizeGroupWhiteEntries(latestGroup.white);
    if (!whiteEntries.some(entry => entry.uid === uid)) {
      await patchFirestoreRestDocument(
        `groups/${groupId}`,
        { white: ensureDisabledGroupWhiteEntry(latestGroup.white, uid) },
        ["white"],
      );
    }
  } catch (error) {
    console.error("Failed to record auth login", error);
    return NextResponse.json({ error: "Failed to record auth login" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true, authorized }, { status: 200 });
  setWebSessionCookie(response, idToken);
  return response;
}
