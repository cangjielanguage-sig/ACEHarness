import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';
import { createEngine, getConfiguredEngine } from '@/lib/engines/engine-factory';
import { buildDashboardSystemPrompt } from '@/lib/chat-system-prompt';
import { loadChatSettings } from '@/lib/chat-settings';

const DEFAULT_PROMPT = '你是一个 AI 助手，简洁回答问题。';

export async function POST(request: NextRequest) {
  try {
    const { message, model, sessionId, mode } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const id = `chat-${Date.now()}`;
    const useModel = model || '';

    // Build system prompt based on mode
    let systemPrompt = DEFAULT_PROMPT;
    if (mode === 'dashboard') {
      const settings = await loadChatSettings();
      const enabledSkills = Object.entries(settings.skills)
        .filter(([, v]) => v)
        .map(([k]) => k);
      systemPrompt = await buildDashboardSystemPrompt(enabledSkills);
    }

    const engineType = await getConfiguredEngine();
    const engine = await createEngine(engineType);

    if (engine) {
      const chunks: string[] = [];
      engine.on('stream', (event: any) => {
        if (event.type === 'text') chunks.push(event.content);
      });

      const result = await engine.execute({
        agent: 'chat',
        step: 'chat',
        prompt: message,
        systemPrompt,
        model: useModel,
        workingDirectory: process.cwd(),
        sessionId: sessionId || undefined,
      });

      engine.cancel();

      return NextResponse.json({
        result: result.output || chunks.join(''),
        sessionId: result.sessionId,
        isError: !result.success,
      });
    }

    // Fallback: Claude Code via process-manager
    const result = await processManager.executeClaudeCli(
      id,
      'chat-test',
      'chat',
      message,
      systemPrompt,
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
      { error: error.message || 'CLI 调用失败' },
      { status: 500 }
    );
  }
}
