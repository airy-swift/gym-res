import { NextRequest, NextResponse } from 'next/server';

import { isAuthorizedRequest } from '@/lib/api/auth';
import {
  createDispatchedJob,
  formatHistoryTimestamp,
  getJobDocument,
  patchJobDocument,
} from '@/lib/api/job-store';
import {
  setFirestoreRestDocument,
} from '@/lib/firebase/firestore-rest';

export async function POST(request: NextRequest) {
  let body: { userId?: string; password?: string; entryCount?: number; groupId?: string; label?: string };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, password, entryCount, groupId, label } = body;

  if (!userId || !password || entryCount === undefined || !groupId) {
    return NextResponse.json({ error: 'Missing userId, password, entryCount, or groupId' }, { status: 400 });
  }

  if (!Number.isInteger(entryCount)) {
    return NextResponse.json({ error: 'entryCount must be an integer' }, { status: 400 });
  }

  // try {
  //   const whitelistDoc = await getDoc(doc(db, 'whitelist', userId));

  //   if (!whitelistDoc.exists()) {
  //     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  //   }
  // } catch (error) {
  //   console.error('Failed to verify whitelist membership', error);
  //   return NextResponse.json({ error: 'Failed to verify permissions' }, { status: 500 });
  // }

  try {
    const jobId = await createDispatchedJob({
      userId,
      password,
      entryCount,
      groupId,
      label,
      message: 'ボブと太郎が今、一生懸命頑張っています。',
      progress: '準備してます',
    });

    return NextResponse.json({ jobId }, { status: 201 });
  } catch (error) {
    console.error('Failed to create job', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  try {
    const document = await getJobDocument(jobId);

    if (!document) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ jobId, ...document.data }, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch job', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { jobId?: string; status?: string; message?: string };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jobId, status, message } = body;

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  if (status === undefined && message === undefined) {
    return NextResponse.json({ error: 'status or message is required' }, { status: 400 });
  }

  let groupId: string | undefined;
  let jobUserId: string | undefined;

  try {
    const document = await getJobDocument(jobId);

    if (!document) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const jobData = document.data as { groupId?: string; userId?: string };
    groupId = jobData.groupId;
    jobUserId = jobData.userId;
  } catch (error) {
    console.error('Failed to fetch job before update', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }

  if (!groupId || !jobUserId) {
    return NextResponse.json({ error: 'Job is missing groupId or userId' }, { status: 400 });
  }

  try {
    const historyDocId = formatHistoryTimestamp(new Date());
    const historyDocData: Record<string, unknown> = {
      userId: jobUserId,
      message: message ?? null,
    };

    await Promise.all([
      patchJobDocument(jobId, { status, message, clearCredentials: true }),
      setFirestoreRestDocument(`groups/${groupId}/history/${historyDocId}`, historyDocData),
    ]);
    return NextResponse.json({ jobId }, { status: 200 });
  } catch (error) {
    console.error('Failed to update job', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
