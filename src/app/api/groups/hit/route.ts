import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, updateDoc } from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase/app";
import { encryptGroupIds } from "@/lib/security/group-ids-crypto";

type SaveHitIdsRequestBody = {
  groupId?: unknown;
  ids?: unknown;
};

export async function POST(request: NextRequest) {
  let body: SaveHitIdsRequestBody;

  try {
    body = (await request.json()) as SaveHitIdsRequestBody;
  } catch (error) {
    console.error("Invalid JSON payload", error);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  if (typeof body.ids !== "string") {
    return NextResponse.json({ error: "ids must be a string" }, { status: 400 });
  }

  const db = getFirestoreDb();
  const groupRef = doc(db, "groups", groupId);

  try {
    const snapshot = await getDoc(groupRef);

    if (!snapshot.exists()) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("Failed to verify group before save", error);
    return NextResponse.json({ error: "Failed to verify group" }, { status: 500 });
  }

  try {
    const encryptedIds = encryptGroupIds(body.ids);
    await updateDoc(groupRef, { ids: encryptedIds });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to save hit ids", error);
    return NextResponse.json({ error: "Failed to save hit ids" }, { status: 500 });
  }
}
