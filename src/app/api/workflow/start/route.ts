import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';

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

    const manager = await workflowRegistry.getManager(configFile);

    // Check if this specific config is already running
    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running') {
      return NextResponse.json(
        { error: '该配置的工作流已在运行中' },
        { status: 409 }
      );
    }

    manager.start(configFile).catch(() => {});

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
