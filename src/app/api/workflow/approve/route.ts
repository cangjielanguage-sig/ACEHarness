import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    // Check which manager is running
    const phaseStatus = workflowManager.getInternalStatus();
    const smStatus = stateMachineWorkflowManager.getInternalStatus();

    if (phaseStatus === 'running') {
      workflowManager.approve();
    } else if (smStatus === 'running') {
      stateMachineWorkflowManager.approve();
    } else {
      return NextResponse.json(
        { error: '没有正在运行的工作流' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '检查点已批准',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '批准检查点失败', message: error.message },
      { status: 500 }
    );
  }
}
