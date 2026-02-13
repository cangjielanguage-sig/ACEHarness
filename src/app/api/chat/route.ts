import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';

export async function POST(request: NextRequest) {
  try {
    const { message, model, sessionId } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const id = `chat-${Date.now()}`;
    const useModel = model || '';

    const result = await processManager.executeClaudeCli(
      id,
      'chat-test',
      'chat',
      message,
      '你是一个 AI 助手，简洁回答问题。',
      useModel,
      {
        resumeSessionId: sessionId || undefined,
        appendSystemPrompt: !!sessionId,
      }
    );

    return NextResponse.json({
      result: result.result,
      sessionId: result.session_id,
      costUsd: result.cost_usd,
      durationMs: result.duration_ms,
      usage: result.usage,
      isError: result.is_error,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Claude CLI 调用失败' },
      { status: 500 }
    );
  }
}
