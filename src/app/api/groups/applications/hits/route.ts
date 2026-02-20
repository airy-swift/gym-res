import { NextRequest, NextResponse } from "next/server";
import { doc, setDoc } from "firebase/firestore";

import { isAuthorizedRequest } from "@/lib/api/auth";
import { getFirestoreDb } from "@/lib/firebase/app";

export const runtime = "nodejs";

type SaveApplicationHitsBody = {
  groupId?: unknown;
  timestamp?: unknown;
  hits?: unknown;
};

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SaveApplicationHitsBody;

  try {
    body = (await request.json()) as SaveApplicationHitsBody;
  } catch (error) {
    console.error("Invalid JSON payload for application hits", error);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  const timestamp = typeof body.timestamp === "string" ? body.timestamp.trim() : "";
  const rawHits = Array.isArray(body.hits) ? body.hits : null;

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
  }

  if (!rawHits) {
    return NextResponse.json({ error: "hits must be an array" }, { status: 400 });
  }

  const hits = Array.from(
    new Set(
      rawHits
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  try {
    const db = getFirestoreDb();
    await setDoc(
      doc(db, "groups", groupId, "applications", timestamp),
      { hits },
      { merge: true },
    );

    return NextResponse.json({ ok: true, total: hits.length }, { status: 200 });
  } catch (error) {
    console.error("Failed to save application hits", error);
    return NextResponse.json({ error: "Failed to save hits" }, { status: 500 });
  }
}
