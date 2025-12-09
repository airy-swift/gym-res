import { NextRequest, NextResponse } from 'next/server';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { getFirestoreDb } from '@/lib/firebase/app';
import { isAuthorizedRequest } from '@/lib/api/auth';

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestoreDb();

  let body: { jobId?: string; progress?: string };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload for job progress', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jobId, progress } = body;

  if (!jobId || typeof progress !== 'string' || progress.trim().length === 0) {
    return NextResponse.json({ error: 'jobId and progress are required' }, { status: 400 });
  }

  try {
    await updateDoc(doc(db, 'jobs', jobId), {
      progress: progress.trim(),
      updatedAt: serverTimestamp(),
    });
    return NextResponse.json({ jobId, progress: progress.trim() }, { status: 200 });
  } catch (error) {
    console.error('Failed to update job progress', error);
    return NextResponse.json({ error: 'Failed to update progress' }, { status: 500 });
  }
}
