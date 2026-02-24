import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scope, phase, context } = body;

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

    workflowManager.setContext(scope, context || '', phase);

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

export async function GET() {
  try {
    const contexts = workflowManager.getContexts();
    return NextResponse.json(contexts);
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取上下文失败', message: error.message },
      { status: 500 }
    );
  }
}
