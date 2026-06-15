import { NextRequest, NextResponse } from "next/server";

import { decodeHitTargetsFromRawIds } from "@/lib/api/hit-targets";
import { getGroupRepresentativeAccess } from "@/lib/api/group-representative-access";
import { dispatchHitWorkflow } from "@/lib/github/dispatch";

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
    const access = await getGroupRepresentativeAccess(groupId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const hitTargets = decodeHitTargetsFromRawIds(access.group.id, access.group.ids);
    if (hitTargets.length === 0) {
      return NextResponse.json({ error: "ids が未設定です。先に保存してください。" }, { status: 400 });
    }

    await dispatchHitWorkflow(access.group.id);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error("Failed to dispatch hit test workflow", error);
    return NextResponse.json({ error: "Failed to start hit test workflow" }, { status: 500 });
  }
}
