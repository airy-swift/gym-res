import { NextRequest, NextResponse } from "next/server";
import { getStorage, ref, uploadBytes } from "firebase/storage";

import { isAuthorizedRequest } from "@/lib/api/auth";
import { getFirebaseApp, getStorageBucketName } from "@/lib/firebase/app";
import { getFirestoreRestDocument, patchFirestoreRestDocument } from "@/lib/firebase/firestore-rest";
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
  const applicationIdValue = toTrimmedString(formData.get("applicationId"));
  const rawFileName = toTrimmedString(formData.get("fileName"));
  const image = formData.get("image");

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return NextResponse.json({ error: "Invalid timestamp" }, { status: 400 });
  }

  const applicationId = resolveApplicationId(timestamp, applicationIdValue);
  if (!applicationId) {
    return NextResponse.json({ error: "Invalid applicationId" }, { status: 400 });
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

    const documentPath = `groups/${groupId}/applications/${applicationId}`;
    const existingDoc = await getFirestoreRestDocument(documentPath);
    const existingImages = Array.isArray(existingDoc?.data.images)
      ? existingDoc.data.images.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    const updates: Record<string, unknown> = {
      images: Array.from(new Set([...existingImages, storagePath])),
    };
    const updateFields = ["images"];

    if (existingDoc?.data.created_at == null) {
      updates.created_at = new Date();
      updateFields.push("created_at");
    }

    await patchFirestoreRestDocument(documentPath, updates, updateFields);

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

function resolveApplicationId(timestamp: string, value: string): string | null {
  if (!value) {
    return timestamp;
  }

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  return value;
}
