import { NextRequest, NextResponse } from 'next/server';
import { deleteField, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { randomUUID } from 'node:crypto';

import { getFirestoreDb } from '@/lib/firebase/app';
import { dispatchJobWorkflow } from '@/lib/github/dispatch';
import { markJobAsFailed } from '@/lib/api/internal-jobs';

export async function POST(request: NextRequest) {
  const db = getFirestoreDb();
  const jobId = randomUUID().replace(/-/g, '');
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

  try {
    await setDoc(doc(db, 'jobs', jobId), {
      status: 'pending',
      message: 'Job created',
      createdAt: serverTimestamp(),
      progress: '準備！(2分) + 1件あたり30秒程',
      userId,
      password,
      entryCount,
      groupId,
    });

    try {
      await dispatchJobWorkflow(jobId, label);
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

export async function PATCH(request: NextRequest) {
  const db = getFirestoreDb();

  let body: { jobId?: string; status?: string; message?: string };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jobId, status, message } = body;

  if (!jobId || !status || !message) {
    return NextResponse.json({ error: 'jobId, status, and message are required' }, { status: 400 });
  }

  try {
    await updateDoc(doc(db, 'jobs', jobId), {
      status,
      message,
      updatedAt: serverTimestamp(),
      userId: deleteField(),
      password: deleteField(),
    });

    return NextResponse.json({ jobId }, { status: 200 });
  } catch (error) {
    console.error('Failed to update job internally', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
