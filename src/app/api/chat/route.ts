import { NextRequest, NextResponse } from 'next/server';
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

    if (!engine) {
      return NextResponse.json({ error: '引擎不可用，请检查配置' }, { status: 500 });
    }

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
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || '执行失败' },
      { status: 500 }
    );
  }
}
