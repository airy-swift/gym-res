import { NextResponse } from 'next/server';

import { getLatestWorkflowActionsUrl } from '@/lib/github/dispatch';

export async function GET() {
  try {
    const actionsUrl = await getLatestWorkflowActionsUrl();
    return NextResponse.json({ actions_url: actionsUrl ?? null }, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch latest workflow run', error);
    return NextResponse.json({ error: 'Failed to fetch workflow run' }, { status: 500 });
  }
}
