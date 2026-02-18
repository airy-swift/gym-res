import { NextRequest, NextResponse } from "next/server";

import { getGroupDocument } from "@/lib/firebase";
import { dispatchHitWorkflow } from "@/lib/github/dispatch";
import { decodeGroupIdsForDisplay } from "@/lib/security/group-ids-crypto";

type HitTestRequestBody = {
  groupId?: unknown;
};

export async function POST(request: NextRequest) {
  let body: HitTestRequestBody;

  try {
    body = (await request.json()) as HitTestRequestBody;
  } catch (error) {
    console.error("Invalid JSON payload for hit test", error);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  try {
    const group = await getGroupDocument(groupId);
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const decodedIds = decodeGroupIdsForDisplay(group.ids);
    if (!decodedIds.trim()) {
      return NextResponse.json({ error: "ids が未設定です。先に保存してください。" }, { status: 400 });
    }

    await dispatchHitWorkflow(groupId);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error("Failed to dispatch hit test workflow", error);
    return NextResponse.json({ error: "Failed to start hit test workflow" }, { status: 500 });
  }
}
