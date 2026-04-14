import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';
import { StateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const { targetState, instruction, configFile } = await request.json();
    if (!targetState) {
      return NextResponse.json({ error: '缺少目标状态参数' }, { status: 400 });
    }
    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager || !(manager instanceof StateMachineWorkflowManager)) {
      return NextResponse.json({ error: '没有运行中的状态机工作流' }, { status: 400 });
    }
    manager.forceTransition(targetState, instruction);
    return NextResponse.json({ success: true, message: `已请求强制跳转到: ${targetState}` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
