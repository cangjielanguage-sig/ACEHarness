import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';
import { buildDashboardSystemPrompt } from '@/lib/chat-system-prompt';
import { loadChatSettings } from '@/lib/chat-settings';

export const dynamic = 'force-dynamic';

const DEFAULT_PROMPT = '你是一个 AI 助手，简洁回答问题。';

// Track active chat streams
const activeChats = new Map<string, { promise: Promise<any>; settled: boolean; chatId: string }>();

export async function POST(request: NextRequest) {
  try {
    const { message, model, sessionId, mode } = await request.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const chatId = `chat-${Date.now()}`;
    const useModel = model || '';

    let systemPrompt = DEFAULT_PROMPT;
    if (mode === 'dashboard') {
      const settings = await loadChatSettings();
      const enabledSkills = Object.entries(settings.skills)
        .filter(([, v]) => v)
        .map(([k]) => k);
      systemPrompt = await buildDashboardSystemPrompt(enabledSkills);
    }

    // Start execution without awaiting — SSE will stream results
    const execPromise = processManager.executeClaudeCli(
      chatId, 'chat', 'chat', message, systemPrompt, useModel,
      { resumeSessionId: sessionId || undefined, appendSystemPrompt: !!sessionId }
    );

    const entry = { promise: execPromise, settled: false, chatId };
    activeChats.set(chatId, entry);
    execPromise
      .then(() => { entry.settled = true; })
      .catch(() => { entry.settled = true; })
      .finally(() => { setTimeout(() => activeChats.delete(chatId), 30000); });

    return NextResponse.json({ chatId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '启动失败' }, { status: 500 });
  }
}
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('id');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const entry = activeChats.get(chatId);
  if (!entry) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Stream handler — forward text deltas
      const onStream = (evt: any) => {
        if (evt.id === chatId && evt.delta) {
          send('delta', { content: evt.delta });
        }
      };

      processManager.on('stream', onStream);
      send('connected', { chatId });

      // Wait for completion
      entry.promise
        .then((result: any) => {
          send('done', {
            result: result.result,
            sessionId: result.session_id,
            costUsd: result.cost_usd,
            durationMs: result.duration_ms,
            usage: result.usage,
            isError: result.is_error,
          });
        })
        .catch((err: any) => {
          send('error', { message: err.message || '执行失败' });
        })
        .finally(() => {
          processManager.off('stream', onStream);
          try { controller.close(); } catch {}
        });

      // Cleanup on client disconnect
      request.signal.addEventListener('abort', () => {
        processManager.off('stream', onStream);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function DELETE(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('id');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const killed = processManager.killProcess(chatId);
  activeChats.delete(chatId);
  return NextResponse.json({ killed });
}
