import { decodeGroupIdsForDisplay } from "@/lib/security/group-ids-crypto";

export type HitTarget = {
  groupId: string;
  userId: string;
  password: string;
};

export type HitTargetDescriptor = {
  groupId: string;
  rowIndex: number;
};

export function parseHitTargetCsv(groupId: string, text: string): HitTarget[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap((line): HitTarget[] => {
      const [userId = "", password = ""] = line.split(",").map(part => part.trim());
      if (!userId || !password) {
        return [];
      }

      return [{ groupId, userId, password }];
    });
}

export function decodeHitTargetsFromRawIds(groupId: string, rawIds: unknown): HitTarget[] {
  const decodedIds = decodeGroupIdsForDisplay(rawIds);
  if (!decodedIds.trim()) {
    return [];
  }

  const dedupe = new Set<string>();
  const uniqueEntries: HitTarget[] = [];

  for (const entry of parseHitTargetCsv(groupId, decodedIds)) {
    const dedupeKey = `${entry.userId}\u0000${entry.password}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.add(dedupeKey);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

export function buildHitTargetDescriptors(groupId: string, rawIds: unknown): HitTargetDescriptor[] {
  return decodeHitTargetsFromRawIds(groupId, rawIds).map((_, rowIndex) => ({ groupId, rowIndex }));
}
