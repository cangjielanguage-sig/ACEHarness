import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';
import { loadRunState } from '@/lib/run-state-persistence';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, stepName } = body;

    if (!runId || !stepName) {
      return NextResponse.json(
        { error: '缺少 runId 或 stepName 参数' },
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

    // Fire-and-forget
    manager.rerunFromStep(runId, stepName).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `正在从步骤 "${stepName}" 重新运行`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '重新运行失败', message: error.message },
      { status: 500 }
    );
  }
}
