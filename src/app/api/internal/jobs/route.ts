import { NextRequest, NextResponse } from 'next/server';

import { isAuthorizedRequest } from '@/lib/api/auth';
import { createDispatchedJob, patchJobDocument } from '@/lib/api/job-store';

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    const jobId = await createDispatchedJob({
      userId,
      password,
      entryCount,
      groupId,
      label,
      message: 'Job created',
      progress: '準備！(2分) + 1件あたり30秒程',
    });

    return NextResponse.json({ jobId }, { status: 201 });
  } catch (error) {
    console.error('Failed to create job', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
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

  if (!jobId || !status || !message) {
    return NextResponse.json({ error: 'jobId, status, and message are required' }, { status: 400 });
  }

  try {
    await patchJobDocument(jobId, { status, message, clearCredentials: true });

    return NextResponse.json({ jobId }, { status: 200 });
  } catch (error) {
    console.error('Failed to update job internally', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
