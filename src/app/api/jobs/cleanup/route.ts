import { NextRequest, NextResponse } from 'next/server';

import { isAuthorizedRequest } from '@/lib/api/auth';
import { getFirestoreRestDocument, patchFirestoreRestDocument } from '@/lib/firebase/firestore-rest';

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    const document = await getFirestoreRestDocument(`jobs/${jobId}`);

    if (!document) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    await patchFirestoreRestDocument(`jobs/${jobId}`, { updatedAt: new Date() }, ['updatedAt', 'userId', 'password']);

    return NextResponse.json({ jobId }, { status: 200 });
  } catch (error) {
    console.error('Failed to cleanup job credentials', error);
    return NextResponse.json({ error: 'Failed to cleanup job' }, { status: 500 });
  }
}
