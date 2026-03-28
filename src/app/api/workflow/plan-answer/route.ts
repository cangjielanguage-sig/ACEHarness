import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { answer, configFile } = body;

    if (!answer?.trim()) {
      return NextResponse.json(
        { error: '回答内容不能为空' },
        { status: 400 }
      );
    }

    // Find running manager with a pending question
    const running = configFile
      ? [{ manager: workflowRegistry.getRunningManager(configFile) }].filter(r => r.manager)
      : workflowRegistry.getRunningManagers();

    for (const { manager } of running) {
      if (!manager) continue;
      const q = manager.getPendingUserQuestion();
      if (q) {
        manager.submitUserAnswer(answer.trim());
        return NextResponse.json({
          success: true,
          message: '回答已提交',
          question: q.question,
        });
      }
    }

    return NextResponse.json(
      { error: '当前没有等待回答的问题' },
      { status: 409 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: '提交回答失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const configFile = request.nextUrl.searchParams.get('configFile');

  const running = workflowRegistry.getRunningManagers();
  for (const { manager, configFile: cf } of running) {
    if (configFile && cf !== configFile) continue;
    const q = manager.getPendingUserQuestion();
    if (q) {
      return NextResponse.json({ running: true, pendingQuestion: q });
    }
  }

  return NextResponse.json({
    running: running.length > 0,
    pendingQuestion: null,
  });
}
