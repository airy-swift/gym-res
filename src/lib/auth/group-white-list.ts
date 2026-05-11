export type GroupWhiteEntry = {
  uid: string;
  enable: boolean;
};

export function normalizeGroupWhiteEntries(rawWhite: unknown): GroupWhiteEntry[] {
  if (!Array.isArray(rawWhite)) {
    return [];
  }

  return rawWhite.flatMap((entry): GroupWhiteEntry[] => {
    if (typeof entry === "string") {
      const uid = entry.trim();
      return uid ? [{ uid, enable: true }] : [];
    }

    if (!isRecord(entry) || typeof entry.uid !== "string") {
      return [];
    }

    const uid = entry.uid.trim();
    if (!uid) {
      return [];
    }

    return [{ uid, enable: entry.enable === true }];
  });
}

export function isGroupUserEnabled(rawWhite: unknown, uid: string): boolean {
  return normalizeGroupWhiteEntries(rawWhite).some(entry => entry.uid === uid && entry.enable);
}

export function ensureDisabledGroupWhiteEntry(rawWhite: unknown, uid: string): GroupWhiteEntry[] {
  const normalizedUid = uid.trim();
  const entries = normalizeGroupWhiteEntries(rawWhite);

  if (!normalizedUid || entries.some(entry => entry.uid === normalizedUid)) {
    return entries;
  }

  return [...entries, { uid: normalizedUid, enable: false }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
