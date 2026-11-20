import { NextRequest, NextResponse } from 'next/server';

import { isAuthorizedRequest } from '@/lib/api/auth';
import { parseJobInput } from '@/lib/api/job-input';
import { createDispatchedJob, patchJobDocument } from '@/lib/api/job-store';

export async function POST(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    console.error('Invalid JSON payload');
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseJobInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const jobId = await createDispatchedJob({
      ...parsed.input,
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
