import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { configFile } = body;

    if (!configFile) {
      return NextResponse.json(
        { error: '缺少配置文件参数' },
        { status: 400 }
      );
    }

    // Check if already running before kicking off
    const currentStatus = workflowManager.getStatus();
    if (currentStatus.status === 'running') {
      return NextResponse.json(
        { error: '已有工作流正在运行' },
        { status: 409 }
      );
    }

    // Fire-and-forget: kick off the workflow without awaiting completion.
    // Progress and errors are streamed to the client via SSE (/api/workflow/events).
    workflowManager.start(configFile).catch(() => {
      // Errors are already emitted as 'status' events inside start(),
      // so the SSE stream will notify the frontend.
    });

    return NextResponse.json({
      success: true,
      message: '工作流已启动',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '启动工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
