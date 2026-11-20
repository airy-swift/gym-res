import { NextRequest, NextResponse } from 'next/server';

import { isAuthorizedRequest } from '@/lib/api/auth';
import { parseJobInput } from '@/lib/api/job-input';
import {
  createDispatchedJob,
  formatHistoryTimestamp,
  getJobDocumentForRunner,
  patchJobDocument,
} from '@/lib/api/job-store';
import {
  getFirestoreRestDocument,
  setFirestoreRestDocument,
} from '@/lib/firebase/firestore-rest';

export async function POST(request: NextRequest) {
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
    // 通常応募は画面と同じく、有効なグループURLを持つ利用者に許可する。
    if (!await getFirestoreRestDocument(`groups/${parsed.input.groupId}`)) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
  } catch {
    console.error('Failed to verify group before creating job');
    return NextResponse.json({ error: 'グループ情報を取得できませんでした。時間をおいて再試行してください。' }, { status: 503 });
  }

  try {
    const jobId = await createDispatchedJob({
      ...parsed.input,
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
    const document = await getJobDocumentForRunner(jobId);

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
    const document = await getJobDocumentForRunner(jobId);

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
