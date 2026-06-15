import { NextRequest, NextResponse } from 'next/server';

import { isAuthorizedRequest } from '@/lib/api/auth';
import {
  buildHitTargetDescriptors,
  decodeHitTargetsFromRawIds,
  type HitTarget,
  type HitTargetDescriptor,
} from '@/lib/api/hit-targets';
import { getFirestoreRestDocument, listFirestoreRestCollection } from '@/lib/firebase/firestore-rest';

async function collectAllHitTargetDescriptors(): Promise<HitTargetDescriptor[]> {
  const descriptors: HitTargetDescriptor[] = [];
  const groupDocuments = await listFirestoreRestCollection('groups');

  for (const groupDocument of groupDocuments) {
    const groupId = groupDocument.id;
    descriptors.push(...buildHitTargetDescriptors(groupId, groupDocument.data.ids));
  }

  return descriptors;
}

async function collectHitTargetDescriptorsByGroupId(groupId: string): Promise<HitTargetDescriptor[]> {
  const document = await getFirestoreRestDocument(`groups/${groupId}`);
  if (!document) {
    return [];
  }

  return buildHitTargetDescriptors(groupId, document.data.ids);
}

async function resolveGroupTarget(groupId: string, rowIndex: number): Promise<HitTarget | null> {
  const document = await getFirestoreRestDocument(`groups/${groupId}`);
  if (!document) {
    return null;
  }

  const entries = decodeHitTargetsFromRawIds(groupId, document.data.ids);
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
