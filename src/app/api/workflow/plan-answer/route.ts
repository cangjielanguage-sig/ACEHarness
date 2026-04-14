import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';
import { StateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { answer, answers, configFile, type } = body;

    const running = configFile
      ? [{ manager: workflowRegistry.getRunningManager(configFile) }].filter(r => r.manager)
      : workflowRegistry.getRunningManagers();

    if (type === 'sdk-plan-review') {
      const { action, content, feedback } = body;
      if (!action || !['approve', 'edit', 'reject'].includes(action)) {
        return NextResponse.json({ error: 'action 必须为 approve / edit / reject' }, { status: 400 });
      }
      for (const { manager } of running) {
        if (!manager) continue;
        if (!(manager instanceof StateMachineWorkflowManager)) continue;
        const pending = manager.getPendingPlanReview();
        if (pending) {
          manager.submitPlanReview({ action, content, feedback });
          return NextResponse.json({
            success: true,
            message: `Plan 审批已提交: ${action}`,
          });
        }
      }
      return NextResponse.json(
        { error: '当前没有等待审批的 Plan' },
        { status: 409 }
      );
    }

    if (type === 'sdk-plan') {
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return NextResponse.json({ error: 'answers 必须为对象' }, { status: 400 });
      }
      for (const { manager } of running) {
        if (!manager) continue;
        const pending = manager.getPendingSdkPlanQuestion();
        if (pending) {
          manager.submitSdkPlanAnswers(answers as Record<string, string>);
          return NextResponse.json({
            success: true,
            message: 'SDK Plan 回答已提交',
          });
        }
      }
      return NextResponse.json(
        { error: '当前没有等待回答的 SDK Plan 问题' },
        { status: 409 }
      );
    }

    if (!answer?.trim()) {
      return NextResponse.json(
        { error: '回答内容不能为空' },
        { status: 400 }
      );
    }

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
      return NextResponse.json({ running: true, pendingQuestion: q, pendingSdkPlanQuestion: null, pendingPlanReview: null });
    }
    const sdkQ = manager.getPendingSdkPlanQuestion();
    if (sdkQ) {
      return NextResponse.json({
        running: true,
        pendingQuestion: null,
        pendingSdkPlanQuestion: sdkQ,
        pendingPlanReview: null,
      });
    }
    const pr = manager instanceof StateMachineWorkflowManager ? manager.getPendingPlanReview() : null;
    if (pr) {
      return NextResponse.json({
        running: true,
        pendingQuestion: null,
        pendingSdkPlanQuestion: null,
        pendingPlanReview: pr,
      });
    }
  }

  return NextResponse.json({
    running: running.length > 0,
    pendingQuestion: null,
    pendingSdkPlanQuestion: null,
    pendingPlanReview: null,
  });
}
