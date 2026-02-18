import { NextRequest, NextResponse } from 'next/server';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

import { isAuthorizedRequest } from '@/lib/api/auth';
import { getFirestoreDb } from '@/lib/firebase/app';
import { decodeGroupIdsForDisplay } from '@/lib/security/group-ids-crypto';

type HitTarget = {
  groupId: string;
  userId: string;
  password: string;
};

type HitTargetDescriptor = {
  groupId: string;
  rowIndex: number;
};

function parseCsvEntries(groupId: string, text: string): HitTarget[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries: HitTarget[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const parts = line.split(',').map((part) => part.trim());

    if (parts.length < 2) {
      continue;
    }

    const [userId, password] = parts;

    if (!userId || !password) {
      continue;
    }

    entries.push({ groupId, userId, password });
  }

  return entries;
}

function decodeTargetsFromRawIds(groupId: string, rawIds: unknown): HitTarget[] {
  const decodedIds = decodeGroupIdsForDisplay(rawIds);
  if (!decodedIds.trim()) {
    return [];
  }

  const dedupe = new Set<string>();
  const entries = parseCsvEntries(groupId, decodedIds);
  const uniqueEntries: HitTarget[] = [];

  for (const entry of entries) {
    const dedupeKey = `${entry.userId}\u0000${entry.password}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

async function collectAllHitTargetDescriptors(): Promise<HitTargetDescriptor[]> {
  const db = getFirestoreDb();
  const descriptors: HitTargetDescriptor[] = [];
  const groupsSnapshot = await getDocs(collection(db, 'groups'));

  for (const groupDoc of groupsSnapshot.docs) {
    const groupId = groupDoc.id;
    const entries = decodeTargetsFromRawIds(groupId, groupDoc.get('ids'));
    for (let rowIndex = 0; rowIndex < entries.length; rowIndex += 1) {
      descriptors.push({ groupId, rowIndex });
    }
  }

  return descriptors;
}

async function collectHitTargetDescriptorsByGroupId(groupId: string): Promise<HitTargetDescriptor[]> {
  const db = getFirestoreDb();
  const snapshot = await getDoc(doc(db, 'groups', groupId));
  if (!snapshot.exists()) {
    return [];
  }

  const entries = decodeTargetsFromRawIds(groupId, snapshot.get('ids'));
  return entries.map((_, rowIndex) => ({ groupId, rowIndex }));
}

async function resolveGroupTarget(groupId: string, rowIndex: number): Promise<HitTarget | null> {
  const db = getFirestoreDb();
  const snapshot = await getDoc(doc(db, 'groups', groupId));
  if (!snapshot.exists()) {
    return null;
  }

  const entries = decodeTargetsFromRawIds(groupId, snapshot.get('ids'));
  return entries[rowIndex] ?? null;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const groupId = request.nextUrl.searchParams.get('groupId')?.trim() ?? '';
  const rowIndexRaw = request.nextUrl.searchParams.get('rowIndex')?.trim() ?? '';
  const hasGroupId = groupId.length > 0;
  const hasRowIndex = rowIndexRaw.length > 0;
  const shouldResolveCredential = hasGroupId && hasRowIndex;

  try {
    if (!shouldResolveCredential) {
      if (hasRowIndex && !hasGroupId) {
        return NextResponse.json({ error: 'groupId is required when rowIndex is provided' }, { status: 400 });
      }

      const descriptors = hasGroupId
        ? await collectHitTargetDescriptorsByGroupId(groupId)
        : await collectAllHitTargetDescriptors();
      return NextResponse.json({ total: descriptors.length, targets: descriptors }, { status: 200 });
    }

    if (!groupId || !rowIndexRaw) {
      return NextResponse.json({ error: 'groupId and rowIndex are required' }, { status: 400 });
    }

    const rowIndex = Number(rowIndexRaw);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      return NextResponse.json({ error: 'rowIndex must be a non-negative integer' }, { status: 400 });
    }

    const selected = await resolveGroupTarget(groupId, rowIndex);
    if (!selected) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    return NextResponse.json(
      { groupId: selected.groupId, userId: selected.userId, password: selected.password },
      { status: 200 },
    );
  } catch (error) {
    console.error('Failed to build hit targets', error);
    return NextResponse.json({ error: 'Failed to build hit targets' }, { status: 500 });
  }
}
