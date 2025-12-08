import { NextRequest, NextResponse } from 'next/server';

import { getGroupDocument } from '@/lib/firebase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get('groupId');

  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 });
  }

  try {
    const group = await getGroupDocument(groupId);

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const list = Array.isArray(group.list)
      ? group.list.map(entry => ({
          gymName: typeof entry.gymName === 'string' ? entry.gymName : '',
          room: typeof entry.room === 'string' ? entry.room : '',
          date: typeof entry.date === 'string' ? entry.date : '',
          time: typeof entry.time === 'string' ? entry.time : '',
        }))
      : [];

    return NextResponse.json({ list }, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch representative list', error);
    return NextResponse.json({ error: 'Failed to fetch representative list' }, { status: 500 });
  }
}
