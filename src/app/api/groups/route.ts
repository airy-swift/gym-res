import { NextRequest, NextResponse } from 'next/server';

import { getGroupDocument } from '@/lib/firebase';
import { isAuthorizedRequest } from '@/lib/api/auth';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get('groupId');

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 });
  }

  try {
    const group = await getGroupDocument(groupId);

    if (!group) {
      return NextResponse.json({ exists: false }, { status: 404 });
    }

    return NextResponse.json({ exists: true, group: { id: group.id, name: group.name ?? null } }, { status: 200 });
  } catch (error) {
    console.error('Failed to check Firestore document', error);
    return NextResponse.json({ error: 'Failed to check group' }, { status: 500 });
  }
}
