import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { error: '反馈内容不能为空' },
        { status: 400 }
      );
    }

    // Try both managers
    let recalled = workflowManager.recallLiveFeedback(message.trim());
    if (!recalled) {
      recalled = stateMachineWorkflowManager.recallLiveFeedback(message.trim());
    }

    if (!recalled) {
      return NextResponse.json(
        { error: '该反馈已被处理或不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '反馈已撤回',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '撤回反馈失败', message: error.message },
      { status: 500 }
    );
  }
}
