import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';

export async function GET(request: NextRequest) {
  try {
    const configFile = request.nextUrl.searchParams.get('configFile');

    if (configFile) {
      const manager = await workflowRegistry.getManager(configFile);
      return NextResponse.json(manager.getStatus());
    }

    // No configFile — return first running manager's status, or first idle
    const running = workflowRegistry.getRunningManagers();
    if (running.length > 0) {
      return NextResponse.json(running[0].manager.getStatus());
    }

    const all = workflowRegistry.getAllManagers();
    if (all.length > 0) {
      return NextResponse.json(all[all.length - 1].manager.getStatus());
    }

    return NextResponse.json({ status: 'idle' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取状态失败', message: error.message },
      { status: 500 }
    );
  }
}
