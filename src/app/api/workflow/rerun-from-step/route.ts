import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

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

    const currentStatus = workflowManager.getStatus();
    if (currentStatus.status === 'running') {
      return NextResponse.json(
        { error: '已有工作流正在运行' },
        { status: 409 }
      );
    }

    // Fire-and-forget
    workflowManager.rerunFromStep(runId, stepName).catch(() => {});

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
