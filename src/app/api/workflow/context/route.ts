import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';
import { loadRunState, saveRunState } from '@/lib/run-state-persistence';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scope, phase, context, runId } = body;

    if (!scope || !['global', 'phase'].includes(scope)) {
      return NextResponse.json(
        { error: 'scope 必须为 "global" 或 "phase"' },
        { status: 400 }
      );
    }

    if (scope === 'phase' && !phase) {
      return NextResponse.json(
        { error: '阶段上下文需要指定 phase 名称' },
        { status: 400 }
      );
    }

    // Check both managers to find which one is running
    const phaseStatus = workflowManager.getStatus();
    const smStatus = stateMachineWorkflowManager.getStatus();

    let manager;
    let currentRunId = runId;
    if (phaseStatus.status === 'running') {
      manager = workflowManager;
      currentRunId = currentRunId || phaseStatus.runId;
    } else if (smStatus.status === 'running') {
      manager = stateMachineWorkflowManager;
      currentRunId = currentRunId || smStatus.runId;
    } else {
      // When neither is running, use state machine manager by default
      manager = stateMachineWorkflowManager;
    }

    manager.setContext(scope, context || '', phase);

    // Persist context to state.yaml if we have a runId
    if (currentRunId) {
      const runState = await loadRunState(currentRunId);
      if (runState) {
        if (scope === 'global') {
          runState.globalContext = context || '';
        } else if (phase) {
          runState.phaseContexts = runState.phaseContexts || {};
          runState.phaseContexts[phase] = context || '';
        }
        await saveRunState(runState);
      }
    }

    return NextResponse.json({
      success: true,
      message: '上下文已更新',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '设置上下文失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Check both managers
    const phaseStatus = workflowManager.getStatus();
    const smStatus = stateMachineWorkflowManager.getStatus();

    let contexts;
    if (phaseStatus.status === 'running') {
      contexts = workflowManager.getContexts();
    } else if (smStatus.status === 'running') {
      contexts = stateMachineWorkflowManager.getContexts();
    } else {
      // When neither is running, use state machine manager by default
      contexts = stateMachineWorkflowManager.getContexts();
    }

    return NextResponse.json(contexts);
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取上下文失败', message: error.message },
      { status: 500 }
    );
  }
}
