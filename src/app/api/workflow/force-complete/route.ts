import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    // Check both managers to find which one is running
    const phaseStatus = workflowManager.getStatus();
    const smStatus = stateMachineWorkflowManager.getStatus();

    let manager;
    if (phaseStatus.status === 'running') {
      manager = workflowManager;
      console.log('[force-complete] using phase-based manager, status:', phaseStatus.status, 'currentStep:', workflowManager.getCurrentStep());
    } else if (smStatus.status === 'running') {
      manager = stateMachineWorkflowManager;
      console.log('[force-complete] using state machine manager, status:', smStatus.status, 'currentState:', smStatus.currentState);
    } else {
      return NextResponse.json(
        { error: '当前没有运行中的工作流' },
        { status: 400 }
      );
    }

    const result = await manager.forceCompleteStep();
    if (!result) {
      console.log('[force-complete] returned null — no running step found');
      return NextResponse.json(
        { error: '当前没有正在运行的步骤' },
        { status: 400 }
      );
    }
    console.log('[force-complete] success:', result.step, 'output length:', result.output.length);
    return NextResponse.json({
      success: true,
      step: result.step,
      outputLength: result.output.length,
      message: `步骤 "${result.step}" 已强制完成`,
    });
  } catch (error: any) {
    console.error('[force-complete] error:', error);
    return NextResponse.json(
      { error: '强制完成失败', message: error.message },
      { status: 500 }
    );
  }
}
