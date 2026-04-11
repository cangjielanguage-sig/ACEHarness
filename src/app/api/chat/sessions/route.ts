import { NextRequest, NextResponse } from 'next/server';
import { listChatSessions, saveChatSession } from '@/lib/chat-persistence';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  try {
    const allSessions = await listChatSessions();
    // Filter: admin sees all, user sees public + own
    let sessions = allSessions;
    if (!(user instanceof NextResponse) && user.role !== 'admin') {
      sessions = allSessions.filter(s =>
        (s as any).visibility !== 'private' || (s as any).createdBy === user.id
      );
    }
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  try {
    const body = await request.json();
    const session = {
      id: body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: body.title || '新对话',
      model: body.model || 'claude-sonnet-4-6',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      createdBy: !(user instanceof NextResponse) ? user.id : undefined,
      visibility: (body.visibility as 'public' | 'private') || 'public',
    };
    await saveChatSession(session);
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
