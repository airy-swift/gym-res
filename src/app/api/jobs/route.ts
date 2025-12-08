import { NextRequest, NextResponse } from 'next/server';
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { randomUUID } from 'node:crypto';

import { getFirestoreDb } from '@/lib/firebase/app';
import { isAuthorizedRequest } from '@/lib/api/auth';

export async function POST(request: NextRequest) {
  // if (!isAuthorizedRequest(request)) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // }

  const db = getFirestoreDb();
  const jobId = randomUUID().replace(/-/g, '');
  let body: { userId?: string; password?: string; entryCount?: number };

  try {
    body = await request.json();
  } catch (error) {
    console.error('Invalid JSON payload', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, password, entryCount } = body;

  if (!userId || !password || entryCount === undefined) {
    return NextResponse.json({ error: 'Missing userId, password, or entryCount' }, { status: 400 });
  }

  if (!Number.isInteger(entryCount)) {
    return NextResponse.json({ error: 'entryCount must be an integer' }, { status: 400 });
  }

  try {
    await setDoc(doc(db, 'jobs', jobId), {
      status: 'pending',
      message: 'Job created',
      createdAt: serverTimestamp(),
      userId,
      password,
      entryCount,
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
