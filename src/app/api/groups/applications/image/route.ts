import { NextRequest, NextResponse } from "next/server";
import { arrayUnion, doc, setDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes } from "firebase/storage";

import { isAuthorizedRequest } from "@/lib/api/auth";
import { getFirebaseApp, getFirestoreDb } from "@/lib/firebase/app";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (error) {
    console.error("Invalid multipart payload", error);
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const groupId = toTrimmedString(formData.get("groupId"));
  const timestamp = toTrimmedString(formData.get("timestamp"));
  const rawFileName = toTrimmedString(formData.get("fileName"));
  const image = formData.get("image");

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
  }

  if (!(image instanceof File)) {
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  const safeFileName = sanitizeFileName(rawFileName || image.name || "image.jpg");
  const storagePath = `groups/${groupId}/applications/${timestamp}/${safeFileName}`;

  try {
    const imageBuffer = new Uint8Array(await image.arrayBuffer());
    const storage = getStorage(getFirebaseApp());
    await uploadBytes(ref(storage, storagePath), imageBuffer, {
      contentType: image.type || "image/jpeg",
    });

    const db = getFirestoreDb();
    await setDoc(
      doc(db, "groups", groupId, "applications", timestamp),
      { images: arrayUnion(storagePath) },
      { merge: true },
    );

    return NextResponse.json({ ok: true, storagePath }, { status: 200 });
  } catch (error) {
    console.error("Failed to upload application image", error);
    return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
  }
}

function toTrimmedString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeFileName(rawValue: string): string {
  const baseName = rawValue.split(/[\\/]/).pop() ?? "image.jpg";
  const replaced = baseName.replace(/[^A-Za-z0-9._-]/g, "_");
  return replaced || "image.jpg";
}
