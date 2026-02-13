import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { processManager } from '@/lib/process-manager';

export async function POST(request: NextRequest) {
  try {
    await workflowManager.stop();
    // Also kill any orphan system-level claude processes
    const { killed } = await processManager.killAllSystem();

    return NextResponse.json({
      success: true,
      message: killed > 0 ? `工作流已停止，清理了 ${killed} 个残留进程` : '工作流已停止',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '停止工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
