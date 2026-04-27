import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { getGroupDocument } from "@/lib/firebase";
import { getFirestoreDb } from "@/lib/firebase/app";
import { setWebSessionCookie, verifyFirebaseIdToken } from "@/lib/auth/web-session";

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

  const whiteList = Array.isArray(group.white)
    ? group.white.filter((value): value is string => typeof value === "string")
    : [];
  const authorized = whiteList.includes(uid);

  try {
    const db = getFirestoreDb();
    const authRef = doc(db, "groups", groupId, "auth", uid);
    const existing = await getDoc(authRef);

    await setDoc(
      authRef,
      {
        uid,
        ...(existing.data()?.created_at == null ? { created_at: serverTimestamp() } : {}),
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.error("Failed to record auth login", error);
    return NextResponse.json({ error: "Failed to record auth login" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true, uid, authorized }, { status: 200 });
  setWebSessionCookie(response, idToken);
  return response;
}
