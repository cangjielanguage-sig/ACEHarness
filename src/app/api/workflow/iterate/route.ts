import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const feedback = body.feedback || '';

    if (!feedback.trim()) {
      return NextResponse.json(
        { error: '迭代意见不能为空' },
        { status: 400 }
      );
    }

    // Check which manager is running
    const phaseStatus = workflowManager.getInternalStatus();
    const smStatus = stateMachineWorkflowManager.getInternalStatus();

    if (phaseStatus === 'running') {
      workflowManager.requestIteration(feedback);
    } else if (smStatus === 'running') {
      stateMachineWorkflowManager.requestIteration(feedback);
    } else {
      return NextResponse.json(
        { error: '没有正在运行的工作流' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '已请求继续迭代',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '请求迭代失败', message: error.message },
      { status: 500 }
    );
  }
}
