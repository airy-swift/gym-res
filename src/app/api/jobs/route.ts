import { NextRequest, NextResponse } from 'next/server';
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { randomUUID } from 'node:crypto';

import { getFirestoreDb } from '@/lib/firebase/app';
import { isAuthorizedRequest } from '@/lib/api/auth';
import { dispatchJobWorkflow } from '@/lib/github/dispatch';
import { markJobAsFailed } from '@/lib/api/internal-jobs';

export async function POST(request: NextRequest) {
  const db = getFirestoreDb();
  const jobId = randomUUID().replace(/-/g, '');
  let body: { userId?: string; password?: string; entryCount?: number; groupId?: string };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, password, entryCount, groupId } = body;

  if (!userId || !password || entryCount === undefined || !groupId) {
    return NextResponse.json({ error: 'Missing userId, password, entryCount, or groupId' }, { status: 400 });
  }

  if (!Number.isInteger(entryCount)) {
    return NextResponse.json({ error: 'entryCount must be an integer' }, { status: 400 });
  }

  try {
    const whitelistDoc = await getDoc(doc(db, 'whitelist', userId));

    if (!whitelistDoc.exists()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch (error) {
    console.error('Failed to verify whitelist membership', error);
    return NextResponse.json({ error: 'Failed to verify permissions' }, { status: 500 });
  }

  try {
    await setDoc(doc(db, 'jobs', jobId), {
      status: 'pending',
      message: 'Job created',
      createdAt: serverTimestamp(),
      progress: '準備してます',
      userId,
      password,
      entryCount,
      groupId,
    });

    try {
      await dispatchJobWorkflow(jobId);
    } catch (dispatchError) {
      console.error('GitHub Actions dispatch failed', dispatchError);

      try {
        await markJobAsFailed(jobId, 'GitHub Actions dispatch failed');
      } catch (updateError) {
        console.error('Failed to mark job as failed after dispatch error', updateError);
      }

      throw dispatchError;
    }

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

  const db = getFirestoreDb();
  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  try {
    const snapshot = await getDoc(doc(db, 'jobs', jobId));

    if (!snapshot.exists()) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ jobId, ...snapshot.data() }, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch job', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getFirestoreDb();

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

  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    userId: deleteField(),
    password: deleteField(),
  };

  if (status !== undefined) {
    updates.status = status;
  }

  if (message !== undefined) {
    updates.message = message;
  }

  try {
    await updateDoc(doc(db, 'jobs', jobId), updates);
    return NextResponse.json({ jobId }, { status: 200 });
  } catch (error) {
    console.error('Failed to update job', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
