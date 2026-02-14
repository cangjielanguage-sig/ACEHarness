import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, action } = body;

    if (!runId) {
      return NextResponse.json(
        { error: '缺少 runId 参数' },
        { status: 400 }
      );
    }

    const currentStatus = workflowManager.getStatus();
    if (currentStatus.status === 'running') {
      return NextResponse.json(
        { error: '已有工作流正在运行' },
        { status: 409 }
      );
    }

    // If action specified, queue it so waitForApproval resolves immediately
    if (action === 'iterate' || action === 'approve') {
      workflowManager.setQueuedApprovalAction(action);
    }

    // Fire-and-forget: kick off resume without awaiting completion.
    workflowManager.resume(runId).catch(() => {
      // Errors are emitted as 'status' events via SSE.
    });

    return NextResponse.json({
      success: true,
      message: `正在恢复运行: ${runId}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '恢复工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
