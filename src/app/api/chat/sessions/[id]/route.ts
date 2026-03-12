import { NextRequest, NextResponse } from 'next/server';
import { loadChatSession, saveChatSession, deleteChatSession } from '@/lib/chat-persistence';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await loadChatSession(id);
    if (!session) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const session = { ...body, id, updatedAt: Date.now() };
    await saveChatSession(session);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = await deleteChatSession(id);
    if (!deleted) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
