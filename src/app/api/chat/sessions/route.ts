import { NextRequest, NextResponse } from 'next/server';
import { listChatSessions, saveChatSession } from '@/lib/chat-persistence';

export async function GET() {
  try {
    const sessions = await listChatSessions();
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const session = {
      id: body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: body.title || '新对话',
      model: body.model || 'claude-sonnet-4-6',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    await saveChatSession(session);
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
