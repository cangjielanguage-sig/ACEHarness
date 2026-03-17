import { NextRequest, NextResponse } from 'next/server';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const { targetState, instruction } = await request.json();
    if (!targetState) {
      return NextResponse.json({ error: '缺少目标状态参数' }, { status: 400 });
    }
    stateMachineWorkflowManager.forceTransition(targetState, instruction);
    return NextResponse.json({ success: true, message: `已请求强制跳转到: ${targetState}` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
