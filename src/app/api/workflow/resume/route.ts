import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';
import { loadRunState } from '@/lib/run-state-persistence';
import { StateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, action, feedback, targetState, instruction } = body;

    if (!runId) {
      return NextResponse.json(
        { error: '缺少 runId 参数' },
        { status: 400 }
      );
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      return NextResponse.json(
        { error: `找不到运行记录: ${runId}` },
        { status: 404 }
      );
    }

    const manager = await workflowRegistry.getManager(runState.configFile);

    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running') {
      return NextResponse.json(
        { error: '该配置的工作流已在运行中' },
        { status: 409 }
      );
    }

    if (action === 'iterate' || action === 'approve') {
      manager.setQueuedApprovalAction(action);
      if (action === 'iterate' && feedback) {
        manager.setIterationFeedback(feedback);
      }
    }

    if (action === 'force-transition' && manager instanceof StateMachineWorkflowManager && targetState) {
      manager.setQueuedApprovalAction('approve');
      setTimeout(() => {
        (manager as StateMachineWorkflowManager).forceTransition(targetState, instruction);
      }, 500);
    }

    manager.resume(runId).catch(() => {});

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
