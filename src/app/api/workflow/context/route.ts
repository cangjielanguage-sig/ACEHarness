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

    // Update in-memory state for running managers
    const phaseStatus = workflowManager.getStatus();
    const smStatus = stateMachineWorkflowManager.getStatus();

    let currentRunId = runId;
    if (phaseStatus.status === 'running') {
      workflowManager.setContext(scope, context || '', phase);
      currentRunId = currentRunId || phaseStatus.runId;
    } else if (smStatus.status === 'running') {
      stateMachineWorkflowManager.setContext(scope, context || '', phase);
      currentRunId = currentRunId || smStatus.runId;
    }

    // Always persist to state.yaml
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

export async function GET(request: NextRequest) {
  try {
    const runId = request.nextUrl.searchParams.get('runId');

    // Always read from state.yaml as source of truth
    if (runId) {
      const runState = await loadRunState(runId);
      if (runState) {
        return NextResponse.json({
          globalContext: runState.globalContext || '',
          phaseContexts: runState.phaseContexts || {},
        });
      }
    }

    // Fallback: read from in-memory manager
    const phaseStatus = workflowManager.getStatus();
    const smStatus = stateMachineWorkflowManager.getStatus();

    let globalContext = '';
    let phaseContexts: Record<string, string> = {};

    if (phaseStatus.status === 'running') {
      const c = workflowManager.getContexts();
      globalContext = c.globalContext || '';
      phaseContexts = c.phaseContexts || {};
    } else {
      const c = stateMachineWorkflowManager.getContexts();
      globalContext = c.global || '';
      phaseContexts = c.phases || {};
    }

    return NextResponse.json({ globalContext, phaseContexts });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取上下文失败', message: error.message },
      { status: 500 }
    );
  }
}
