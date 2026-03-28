import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';
import { processManager } from '@/lib/process-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { configFile } = body as { configFile?: string };

    if (configFile) {
      const manager = workflowRegistry.getRunningManager(configFile);
      if (manager) await manager.stop();
    } else {
      // Stop all running workflows
      const running = workflowRegistry.getRunningManagers();
      for (const { manager } of running) {
        await manager.stop();
      }
    }

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
