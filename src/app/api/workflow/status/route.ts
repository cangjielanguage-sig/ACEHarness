import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function GET(request: NextRequest) {
  try {
    const status = workflowManager.getStatus();

    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取状态失败', message: error.message },
      { status: 500 }
    );
  }
}
