import { NextRequest, NextResponse } from 'next/server';
import { deleteField, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { isAuthorizedRequest } from '@/lib/api/auth';
import { getFirestoreDb } from '@/lib/firebase/app';

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestoreDb();
  let body: { jobId?: string };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload for cleanup', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jobId } = body ?? {};

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  try {
    const jobRef = doc(db, 'jobs', jobId);
    const snapshot = await getDoc(jobRef);

    if (!snapshot.exists()) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    await updateDoc(jobRef, {
      updatedAt: serverTimestamp(),
      userId: deleteField(),
      password: deleteField(),
    });

    return NextResponse.json({ jobId }, { status: 200 });
  } catch (error) {
    console.error('Failed to cleanup job credentials', error);
    return NextResponse.json({ error: 'Failed to cleanup job' }, { status: 500 });
  }
}
