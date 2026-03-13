import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { answer } = body;

    if (!answer?.trim()) {
      return NextResponse.json(
        { error: '回答内容不能为空' },
        { status: 400 }
      );
    }

    const phaseStatus = workflowManager.getStatus();
    const smStatus = stateMachineWorkflowManager.getStatus();

    let pendingQuestion = null;

    if (phaseStatus.status === 'running') {
      pendingQuestion = workflowManager.getPendingUserQuestion();
      if (pendingQuestion) {
        workflowManager.submitUserAnswer(answer.trim());
      }
    } else if (smStatus.status === 'running') {
      pendingQuestion = stateMachineWorkflowManager.getPendingUserQuestion();
      if (pendingQuestion) {
        stateMachineWorkflowManager.submitUserAnswer(answer.trim());
      }
    }

    if (!pendingQuestion) {
      return NextResponse.json(
        { error: '当前没有等待回答的问题' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '回答已提交',
      question: pendingQuestion.question,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '提交回答失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  const phaseStatus = workflowManager.getStatus();
  const smStatus = stateMachineWorkflowManager.getStatus();

  let pendingQuestion = null;
  let running = false;

  if (phaseStatus.status === 'running') {
    running = true;
    pendingQuestion = workflowManager.getPendingUserQuestion();
  } else if (smStatus.status === 'running') {
    running = true;
    pendingQuestion = stateMachineWorkflowManager.getPendingUserQuestion();
  }

  return NextResponse.json({
    running,
    pendingQuestion,
  });
}
