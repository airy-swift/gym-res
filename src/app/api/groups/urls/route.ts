import { NextRequest, NextResponse } from 'next/server';
import { doc, updateDoc } from 'firebase/firestore';

import { getFirestoreDb } from '@/lib/firebase/app';
import { getGroupDocument } from '@/lib/firebase';

export async function POST(request: NextRequest) {
  let body: { groupId?: string; urls?: unknown };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload', error);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { groupId, urls } = body;

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 });
  }

  if (!Array.isArray(urls)) {
    return NextResponse.json({ error: 'urls must be an array' }, { status: 400 });
  }

  const normalizedUrls = urls
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);

  try {
    const group = await getGroupDocument(groupId);

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const db = getFirestoreDb();
    await updateDoc(doc(db, 'groups', groupId), { urls: normalizedUrls });

    return NextResponse.json({ success: true, urls: normalizedUrls });
  } catch (error) {
    console.error('Failed to update urls', error);
    return NextResponse.json({ error: 'Failed to update urls' }, { status: 500 });
  }
}
