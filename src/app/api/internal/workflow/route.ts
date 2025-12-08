import { NextResponse } from 'next/server';

import { getLatestWorkflowInfo } from '@/lib/github/dispatch';

export async function GET() {
  try {
    const { actionsUrl, jobUrl } = await getLatestWorkflowInfo();
    return NextResponse.json(
      { actions_url: actionsUrl ?? null, job_url: jobUrl ?? null },
      { status: 200 },
    );
  } catch (error) {
    console.error('Failed to fetch latest workflow run', error);
    return NextResponse.json({ error: 'Failed to fetch workflow run' }, { status: 500 });
  }
}
