import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';
import { loadRunState } from '@/lib/run-state-persistence';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, action, feedback } = body;

    if (!runId) {
      return NextResponse.json(
        { error: '缺少 runId 参数' },
        { status: 400 }
      );
    }

    // Load run state to determine workflow mode
    const runState = await loadRunState(runId);
    if (!runState) {
      return NextResponse.json(
        { error: `找不到运行记录: ${runId}` },
        { status: 404 }
      );
    }

    const isStateMachine = runState.mode === 'state-machine';
    const manager = isStateMachine ? stateMachineWorkflowManager : workflowManager;

    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running') {
      return NextResponse.json(
        { error: '已有工作流正在运行' },
        { status: 409 }
      );
    }

    // If action specified, queue it so waitForApproval resolves immediately
    if (action === 'iterate' || action === 'approve') {
      manager.setQueuedApprovalAction(action);
      // If iterate action with feedback, store it
      if (action === 'iterate' && feedback) {
        manager.setIterationFeedback(feedback);
      }
    }

    // Fire-and-forget: kick off resume without awaiting completion.
    manager.resume(runId).catch(() => {
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
