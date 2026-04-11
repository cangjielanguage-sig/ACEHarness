import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';
import { requireAuth } from '@/lib/auth-middleware';

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

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
    if (currentStatus.status === 'running' || currentStatus.status === 'preparing') {
      return NextResponse.json(
        { error: '该配置的工作流已在运行中' },
        { status: 409 }
      );
    }

    // Pass userId for createdBy tracking
    (manager as any)._createdBy = user.id;
    (manager as any)._userPersonalDir = user.personalDir;
    manager.start(configFile).catch((err: any) => {
      console.error(`[Workflow] start failed for ${configFile}:`, err?.message || err);
      // Ensure status reflects the failure so frontend can detect it
      try {
        (manager as any).status = 'failed';
        (manager as any).statusReason = err?.message || '启动失败';
        manager.emit('status', { status: 'failed', message: err?.message || '启动失败' });
      } catch { /* best effort */ }
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
