import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function GET(request: NextRequest) {
  try {
    // Try state machine manager first
    const smStatus = stateMachineWorkflowManager.getStatus();
    if (smStatus.status !== 'idle') {
      return NextResponse.json(smStatus);
    }

    // Fall back to phase-based manager
    const status = workflowManager.getStatus();
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取状态失败', message: error.message },
      { status: 500 }
    );
  }
}
