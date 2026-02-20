import { NextRequest, NextResponse } from "next/server";
import { collection, deleteDoc, getDocs } from "firebase/firestore";
import { deleteObject, getStorage, ref } from "firebase/storage";

import { isAuthorizedRequest } from "@/lib/api/auth";
import { getTodayInJst } from "@/lib/date/jst";
import { getFirebaseApp, getFirestoreDb, getStorageBucketName } from "@/lib/firebase/app";
import {
  deleteFromStorageWithServiceAccount,
  hasServiceAccountUploadConfig,
} from "@/lib/firebase/storage-server-upload";

export const runtime = "nodejs";

type ResetApplicationsMonthBody = {
  groupId?: unknown;
  yearMonth?: unknown;
};

type MonthCursor = {
  year: number;
  month: number;
};

const JST_YEAR_MONTH_FORMATTER = new Intl.DateTimeFormat("ja-JP-u-ca-gregory", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
});

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ResetApplicationsMonthBody = {};
  try {
    body = (await request.json()) as ResetApplicationsMonthBody;
  } catch {
    body = {};
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  const targetMonth = resolveTargetMonth(typeof body.yearMonth === "string" ? body.yearMonth : undefined);
  if (!targetMonth) {
    return NextResponse.json({ error: "Invalid yearMonth. Expected YYYY-MM." }, { status: 400 });
  }

  try {
    const db = getFirestoreDb();
    const snapshot = await getDocs(collection(db, "groups", groupId, "applications"));
    const docs = snapshot.docs;

    const candidateDocs = docs
      .map((docSnapshot) => {
        const data = docSnapshot.data() as { created_at?: unknown; images?: unknown } | undefined;
        const createdAtMs = parseCreatedAtMs(data?.created_at) ?? parseTimestampDocId(docSnapshot.id);
        if (createdAtMs === null) {
          return null;
        }
        if (!isSameMonthJst(createdAtMs, targetMonth)) {
          return null;
        }

        const images = Array.isArray(data?.images)
          ? data.images.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [];

        return {
          ref: docSnapshot.ref,
          docId: docSnapshot.id,
          imagePaths: images,
        };
      })
      .filter((value): value is { ref: (typeof docs)[number]["ref"]; docId: string; imagePaths: string[] } => value !== null);

    const requiresImageDelete = candidateDocs.some((docItem) => docItem.imagePaths.length > 0);
    let storageBucket = "";
    let devStorage: ReturnType<typeof getStorage> | null = null;
    const hasServiceAccount = hasServiceAccountUploadConfig();

    if (requiresImageDelete) {
      storageBucket = getStorageBucketName();
      if (!hasServiceAccount) {
        if (process.env.NODE_ENV !== "development") {
          throw new Error(
            "Server delete requires FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY in production.",
          );
        }
        devStorage = getStorage(getFirebaseApp(), `gs://${storageBucket}`);
      }
    }

    let deletedDocs = 0;
    let deletedImages = 0;
    const skippedDocIds: string[] = [];
    const warnings: string[] = [];

    for (const docItem of candidateDocs) {
      let imageDeleteFailed = false;

      for (const imagePath of docItem.imagePaths) {
        const objectPath = extractStorageObjectPath(imagePath, storageBucket);
        if (!objectPath) {
          imageDeleteFailed = true;
          warnings.push(`Failed to resolve storage path: doc=${docItem.docId}, image=${imagePath}`);
          continue;
        }

        try {
          if (hasServiceAccount) {
            await deleteFromStorageWithServiceAccount({
              bucket: storageBucket,
              objectPath,
            });
          } else if (devStorage) {
            await deleteObject(ref(devStorage, objectPath));
          }
          deletedImages += 1;
        } catch (error) {
          imageDeleteFailed = true;
          warnings.push(
            `Failed to delete image: doc=${docItem.docId}, image=${objectPath}, detail=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      if (imageDeleteFailed) {
        skippedDocIds.push(docItem.docId);
        continue;
      }

      await deleteDoc(docItem.ref);
      deletedDocs += 1;
    }

    return NextResponse.json(
      {
        ok: true,
        targetYearMonth: toYearMonthKey(targetMonth),
        scanned: docs.length,
        targetDocs: candidateDocs.length,
        deletedDocs,
        deletedImages,
        skippedDocIds,
        warnings,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to reset monthly application docs", error);
    return NextResponse.json(
      {
        error: "Failed to reset monthly application docs",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

function resolveTargetMonth(yearMonth: string | undefined): MonthCursor | null {
  const parsed = parseYearMonth(yearMonth);
  if (parsed) {
    return parsed;
  }
  if (yearMonth == null || yearMonth.trim().length === 0) {
    const today = getTodayInJst();
    return { year: today.year, month: today.month };
  }
  return null;
}

function parseYearMonth(value: string | undefined): MonthCursor | null {
  const match = value?.trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || !month) {
    return null;
  }

  return { year, month };
}

function toYearMonthKey(month: MonthCursor): string {
  return `${month.year}-${month.month.toString().padStart(2, "0")}`;
}

function isSameMonthJst(timestampMs: number, targetMonth: MonthCursor): boolean {
  const month = extractJstYearMonth(timestampMs);
  if (!month) {
    return false;
  }
  return month.year === targetMonth.year && month.month === targetMonth.month;
}

function extractJstYearMonth(timestampMs: number): MonthCursor | null {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = JST_YEAR_MONTH_FORMATTER.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!year || !month) {
    return null;
  }

  return { year, month };
}

function parseCreatedAtMs(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  if (typeof value === "number") {
    const normalized = normalizeEpochMs(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return normalizeEpochMs(numeric);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  if (typeof value === "object") {
    const candidate = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis();
      return Number.isFinite(millis) && millis > 0 ? millis : null;
    }

    if (typeof candidate.seconds === "number") {
      const nanoseconds = typeof candidate.nanoseconds === "number" ? candidate.nanoseconds : 0;
      const millis = candidate.seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
      return Number.isFinite(millis) && millis > 0 ? millis : null;
    }
  }

  return null;
}

function parseTimestampDocId(docId: string): number | null {
  const trimmed = docId.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);
  const normalized = normalizeEpochMs(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  return normalized;
}

function normalizeEpochMs(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function extractStorageObjectPath(imagePath: string, storageBucket: string): string | null {
  const trimmed = imagePath.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (url.hostname === "firebasestorage.googleapis.com") {
      const pathMatch = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      const bucket = pathMatch?.[1] ?? "";
      const encodedPath = pathMatch?.[2] ?? "";
      if (!bucket || !encodedPath || bucket !== storageBucket) {
        return null;
      }
      return decodeURIComponent(encodedPath);
    }

    if (url.hostname === "storage.googleapis.com") {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length < 2) {
        return null;
      }
      const bucket = segments[0] ?? "";
      if (bucket !== storageBucket) {
        return null;
      }
      return decodeURIComponent(segments.slice(1).join("/"));
    }
  } catch {
    return null;
  }

  return null;
}
