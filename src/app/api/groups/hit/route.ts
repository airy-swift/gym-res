import { NextRequest, NextResponse } from "next/server";

import { getGroupRepresentativeAccess } from "@/lib/api/group-representative-access";
import { patchFirestoreRestDocument } from "@/lib/firebase/firestore-rest";
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

  try {
    const access = await getGroupRepresentativeAccess(groupId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
  } catch (error) {
    console.error("Failed to verify group representative before save", error);
    return NextResponse.json({ error: "Failed to verify permissions" }, { status: 500 });
  }

  try {
    const encryptedIds = encryptGroupIds(body.ids);
    await patchFirestoreRestDocument(`groups/${groupId}`, { ids: encryptedIds }, ["ids"]);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to save hit ids", error);
    return NextResponse.json({ error: "Failed to save hit ids" }, { status: 500 });
  }
}
