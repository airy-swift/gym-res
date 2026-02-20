import { NextRequest, NextResponse } from "next/server";
import { arrayUnion, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes } from "firebase/storage";

import { isAuthorizedRequest } from "@/lib/api/auth";
import { getFirebaseApp, getFirestoreDb, getStorageBucketName } from "@/lib/firebase/app";
import { hasServiceAccountUploadConfig, uploadToStorageWithServiceAccount } from "@/lib/firebase/storage-server-upload";

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
  const hasServiceAccount = hasServiceAccountUploadConfig();

  try {
    const imageBuffer = new Uint8Array(await image.arrayBuffer());
    const storageBucket = getStorageBucketName();
    const contentType = image.type || "image/jpeg";

    if (hasServiceAccount) {
      await uploadToStorageWithServiceAccount({
        bucket: storageBucket,
        objectPath: storagePath,
        body: imageBuffer,
        contentType,
      });
    } else if (process.env.NODE_ENV === "development") {
      const storage = getStorage(getFirebaseApp(), `gs://${storageBucket}`);
      await uploadBytes(ref(storage, storagePath), imageBuffer, {
        contentType,
      });
    } else {
      throw new Error(
        "Server upload requires FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY in production.",
      );
    }

    const db = getFirestoreDb();
    const applicationRef = doc(db, "groups", groupId, "applications", timestamp);
    const existingDoc = await getDoc(applicationRef);

    await setDoc(
      applicationRef,
      {
        images: arrayUnion(storagePath),
        ...(existingDoc.data()?.created_at == null ? { created_at: serverTimestamp() } : {}),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, storagePath }, { status: 200 });
  } catch (error) {
    console.error("Failed to upload application image", {
      groupId,
      timestamp,
      storagePath,
      hasServiceAccountUploadConfig: hasServiceAccount,
      error,
    });
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to upload image", detail }, { status: 500 });
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
